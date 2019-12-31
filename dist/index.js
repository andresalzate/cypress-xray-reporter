'use strict'
var __importDefault =
  (this && this.__importDefault) ||
  function(mod) {
    return mod && mod.__esModule ? mod : { default: mod }
  }
Object.defineProperty(exports, '__esModule', { value: true })
const mocha_1 = require('mocha')
const fs_1 = __importDefault(require('fs'))
const path_1 = __importDefault(require('path'))
const mkdirp_1 = __importDefault(require('mkdirp'))
const md5_1 = __importDefault(require('md5'))
const debug = require('debug')('xunit-mocha-reporter:tests')
const xml = require('xml')
const stripAnsi = require('strip-ansi')
var STATUS
;(function(STATUS) {
  STATUS['PASSED'] = 'Pass'
  STATUS['FAILED'] = 'Fail'
  STATUS['SKIPPED'] = 'Skip'
})(STATUS || (STATUS = {}))
const INVALID_CHARACTERS = ['\u001b']
function configureDefaults(options) {
  const { reporterOptions } =
    options !== null && options !== void 0 ? options : {}
  return Object.assign(
    {
      mochaFile: process.env.MOCHA_FILE || 'test-results.xml',
      toConsole: false,
      assemblyName: 'Mocha Tests',
      addTags: false,
    },
    reporterOptions
  )
}
function isInvalidSuite(suite) {
  return (
    (!suite.root && !suite.title) ||
    (suite.tests.length === 0 && suite.suites.length === 0)
  )
}
function getTags(testTitle) {
  const regexAllTags = /@[A-Za-z]+=(?:"[\w\d\s-]+"|'[\w\d\s-]+'|[\w\d-]+)/gi
  const regexTag = /@([A-Za-z]+)=(?:"([\w\d\s-]+)"|'([\w\d\s-]+)'|([\w\d-]+))/i
  const result = {
    tags: {},
    cleanTitle: testTitle,
    tagsFound: false,
  }
  const foundTags = testTitle.match(regexAllTags)
  if (foundTags && foundTags.length > 0) {
    result.tagsFound = true
    foundTags.forEach((tag) => {
      var _a, _b
      const [, key, value] =
        ((_b =
          (_a = tag.match(regexTag)) === null || _a === void 0
            ? void 0
            : _a.filter((part) => {
                return part !== undefined
              })),
        _b !== null && _b !== void 0 ? _b : [])
      result.cleanTitle = result.cleanTitle.replace(tag, '')
      if (key) {
        result.tags[key] = value
      }
    })
  }
  result.cleanTitle = result.cleanTitle.trim()
  return result
}
class XUnitMochaReporter extends mocha_1.reporters.Base {
  constructor(runner, options) {
    super(runner, options)
    this.collections = []
    this.collectionQueue = []
    this.removeInvalidCharacters = (input) => {
      return INVALID_CHARACTERS.reduce(
        (text, invalidCharacter) =>
          text.replace(new RegExp(invalidCharacter, 'g'), ''),
        input
      )
    }
    debug('initializing XUnitMochaReporter with options:', options)
    this._options = configureDefaults(options)
    this._runner = runner
    this._runner.on('start', () => {
      if (fs_1.default.existsSync(this._options.mochaFile)) {
        fs_1.default.unlinkSync(this._options.mochaFile)
      }
    })
    this._runner.on('suite', (suite) => {
      var _a
      if (isInvalidSuite(suite)) {
        debug('suite is invalid:', suite)
      } else {
        debug(
          'running suite:',
          ((_a = suite) === null || _a === void 0 ? void 0 : _a.title) ||
            (suite.root ? '[Root suite]' : '[Unknown suite]')
        )
        const collection = this.getCollectionData(suite)
        this.collections.push(collection)
        this.collectionQueue.push(collection)
      }
    })
    this._runner.on('suite end', (suite) => {
      var _a
      debug(
        'completed suite:',
        ((_a = suite) === null || _a === void 0 ? void 0 : _a.title) ||
          (suite.root ? '[Root suite]' : '[Unknown suite]')
      )
      this.collectionQueue.pop()
    })
    this._runner.on('pass', (test) => {
      debug('test passed:', test.title)
      this.lastCollection().push(this.getTestData(test, STATUS.PASSED))
    })
    this._runner.on('fail', (test) => {
      debug('test failed:', test.title)
      this.lastCollection().push(this.getTestData(test, STATUS.FAILED))
    })
    if (this._options.includePending) {
      this._runner.on('pending', (test) => {
        debug('test pending:', test.title)
        this.lastCollection().push(this.getTestData(test, STATUS.SKIPPED))
      })
    }
    this._runner.on('end', () => {
      debug('run complete')
      this.flush(this.collections)
    })
  }
  getCollectionData(suite) {
    return {
      collection: [
        {
          _attr: {
            name: suite.title || 'Root Suite',
            total: suite.tests.length,
            failed: 0,
            skipped: 0,
            passed: 0,
            time: 0,
          },
        },
      ],
    }
  }
  getTestData(test, status) {
    let name = stripAnsi(test.title)
    let tagResult
    if (this._options.addTags) {
      tagResult = getTags(name)
      if (tagResult.tagsFound) {
        name = stripAnsi(tagResult.cleanTitle)
      }
    }
    const testCase = {
      test: [
        {
          _attr: {
            name,
            time:
              typeof test.duration === 'undefined' ? 0 : test.duration / 1000,
            result: status,
          },
        },
      ],
    }
    let allTags = {}
    this.collectionQueue.forEach((collection) => {
      const tagResult = getTags(collection.collection[0]._attr.name)
      if (tagResult && tagResult.tags) {
        allTags = Object.assign(Object.assign({}, allTags), tagResult.tags)
      }
    })
    if (tagResult && tagResult.tags) {
      allTags = Object.assign(Object.assign({}, allTags), tagResult.tags)
    }
    if (Object.keys(allTags).length > 0) {
      testCase.test.push({
        traits: [],
      })
      Object.keys(allTags).forEach((tagName) => {
        let tagValue = ''
        if (allTags[tagName]) {
          tagValue = allTags[tagName]
        }
        const [, traits] = testCase.test
        traits.traits.push({
          trait: [
            {
              _attr: {
                name: tagName,
                value: tagValue,
              },
            },
          ],
        })
      })
    }
    return testCase
  }
  lastCollection() {
    return this.collectionQueue.slice(-1)[0].collection
  }
  flush(collections) {
    const xml = this.getXml(collections)
    this.writeXmlToDisk(xml, this._options.mochaFile)
    if (this._options.toConsole) {
      console.log(xml)
    }
  }
  getXml(collections) {
    const isTest = (test) => {
      return test.test !== undefined
    }
    const isCollection = (collection) => {
      return collection.collection !== undefined
    }
    const addTime = (a, b) => {
      a.time *= 1000
      a.time += b.time * 1000
      a.time /= 1000
    }
    const stats = this._runner.stats
    const summarizeCollection = (collection, parent) => {
      const [{ _attr: collectionAttrs }, ...items] = collection.collection
      collectionAttrs.failed = 0
      collectionAttrs.passed = 0
      collectionAttrs.total = 0
      collectionAttrs.time = 0
      collectionAttrs.skipped = 0
      items.forEach((item) => {
        if (isTest(item)) {
          if (item.test[0]._attr.result === STATUS.SKIPPED) {
            collectionAttrs.skipped++
            collectionAttrs.total++
          }
          if (item.test[0]._attr.result === STATUS.FAILED) {
            collectionAttrs.failed++
            collectionAttrs.total++
          }
          if (item.test[0]._attr.result === STATUS.PASSED) {
            collectionAttrs.passed++
            collectionAttrs.total++
          }
          addTime(collectionAttrs, item.test[0]._attr)
        } else if (isCollection(item)) {
          summarizeCollection(item, collection)
        }
      })
      if (parent) {
        const [{ _attr: parentAttrs }] = parent.collection
        parentAttrs.total += collectionAttrs.total
        parentAttrs.passed += collectionAttrs.passed
        parentAttrs.skipped += collectionAttrs.skipped
        parentAttrs.failed += collectionAttrs.failed
        addTime(parentAttrs, collectionAttrs)
      }
    }
    collections.forEach((collection) => summarizeCollection(collection))
    const [{ _attr: rootAttrs }] = collections[0].collection
    const assembly = {
      assembly: [
        {
          _attr: {
            name: this._options.assemblyName,
            total: rootAttrs.total,
            failed: rootAttrs.failed,
            skipped: rootAttrs.skipped,
            passed: rootAttrs.passed,
            time: rootAttrs.time,
            'run-date': stats.start.toISOString().split('T')[0],
            'run-time': stats.start
              .toISOString()
              .split('T')[1]
              .split('.')[0],
          },
        },
        ...collections,
      ],
    }
    return xml(
      {
        assemblies: [assembly],
      },
      { declaration: true, indent: '  ' }
    )
  }
  writeXmlToDisk(xml, filePath) {
    if (filePath) {
      if (filePath.indexOf('[hash]') !== -1) {
        filePath = filePath.replace('[hash]', md5_1.default(xml))
      }
      mkdirp_1.default.sync(path_1.default.dirname(filePath))
      try {
        fs_1.default.writeFileSync(filePath, xml, 'utf-8')
      } catch (exc) {
        console.error('problem writing results: ' + exc)
      }
    }
  }
}
module.exports = XUnitMochaReporter
