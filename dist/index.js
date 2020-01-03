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
const debug = require('debug')('cypress-xray-reporter'),
  combine = require('debug')('cypress-xray-reporter:combine'),
  xray = require('debug')('cypress-xray-reporter:xray')
const parser = require('fast-xml-parser')
const stripAnsi = require('strip-ansi')
var STATUS
;(function(STATUS) {
  STATUS['PASSED'] = 'Pass'
  STATUS['FAILED'] = 'Fail'
  STATUS['SKIPPED'] = 'Skip'
})(STATUS || (STATUS = {}))
class NoCollectionError extends Error {
  constructor() {
    super(...arguments)
    this.message = 'No collections remain after filtering'
  }
}
const INVALID_CHARACTERS = ['\u001b']
const DEFAULT_PARSER_OPTIONS = { ignoreAttributes: false }
function configureDefaults(options) {
  const { reporterOptions } = options !== null && options !== void 0 ? options : {}
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
  return (!suite.root && !suite.title) || (suite.tests.length === 0 && suite.suites.length === 0)
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
    this._collectionQueue = []
    this.collections = []
    this.removeInvalidCharacters = (input) => {
      return INVALID_CHARACTERS.reduce(
        (text, invalidCharacter) => text.replace(new RegExp(invalidCharacter, 'g'), ''),
        input
      )
    }
    debug('initializing XUnitMochaReporter with options:', options)
    this._options = configureDefaults(options)
    this._runner = runner
    this._runner.on('start', () => {
      if (!this._options.xrayReport && fs_1.default.existsSync(this._options.mochaFile)) {
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
        this._collectionQueue.push(collection)
      }
    })
    this._runner.on('suite end', (suite) => {
      var _a
      debug(
        'completed suite:',
        ((_a = suite) === null || _a === void 0 ? void 0 : _a.title) ||
          (suite.root ? '[Root suite]' : '[Unknown suite]')
      )
      this._collectionQueue.pop()
    })
    this._runner.on('pass', (test) => {
      debug('test passed:', test.title)
      this.lastCollection().test.push(this.getTestData(test, STATUS.PASSED))
    })
    this._runner.on('fail', (test) => {
      debug('test failed:', test.title)
      this.lastCollection().test.push(this.getTestData(test, STATUS.FAILED))
    })
    if (this._options.includePending) {
      this._runner.on('pending', (test) => {
        debug('test pending:', test.title)
        this.lastCollection().test.push(this.getTestData(test, STATUS.SKIPPED))
      })
    }
    this._runner.on('end', () => {
      debug('run complete')
      this.flush(this.collections)
    })
  }
  getCollectionData(suite) {
    return {
      '@_name': suite.title || 'Root Suite',
      '@_total': suite.tests.length,
      '@_failed': 0,
      '@_skipped': 0,
      '@_passed': 0,
      '@_time': 0,
      test: [],
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
      '@_name': name,
      '@_time': typeof test.duration === 'undefined' ? 0 : test.duration / 1000,
      '@_result': status,
    }
    let allTags = {}
    this._collectionQueue.forEach((collection) => {
      const tagResult = getTags(collection['@_name'])
      if (tagResult && tagResult.tags) {
        allTags = Object.assign(Object.assign({}, allTags), tagResult.tags)
      }
    })
    if (tagResult && tagResult.tags) {
      allTags = Object.assign(Object.assign({}, allTags), tagResult.tags)
    }
    if (Object.keys(allTags).length > 0) {
      testCase.traits = { trait: [] }
      Object.keys(allTags).forEach((tagName) => {
        let tagValue = ''
        if (allTags[tagName]) {
          tagValue = allTags[tagName]
        }
        const traits = testCase.traits
        if (this._options.xrayReport && tagName === 'requirement') {
          testCase['@_type'] = tagValue
          testCase['@_method'] = testCase['@_name']
        }
        traits.trait.push({
          '@_name': tagName,
          '@_value': tagValue,
        })
      })
    }
    return testCase
  }
  lastCollection() {
    return this._collectionQueue.slice(-1)[0]
  }
  flush(collections) {
    try {
      const xml = this.getXml(collections)
      this.writeXmlToDisk(xml, this._options.mochaFile)
      if (this._options.toConsole) {
        console.log(xml)
      }
    } catch (e) {
      if (typeof e === typeof NoCollectionError) {
        xray('all collections have been filtered out')
      }
    }
  }
  getXml(collections) {
    var _a
    const addTime = (c, t) => {
      c['@_time'] *= 1000
      c['@_time'] += t['@_time'] * 1000
      c['@_time'] /= 1000
    }
    const stats = this._runner.stats
    const filteredCollections = collections
      .map((collection) => {
        const tests =
          collection.test === undefined
            ? undefined
            : Array.isArray(collection.test)
            ? collection.test
            : [collection.test]
        collection['@_failed'] = 0
        collection['@_passed'] = 0
        collection['@_total'] = 0
        collection['@_time'] = 0
        collection['@_skipped'] = 0
        if (tests) {
          tests.forEach((_test) => {
            if (_test['@_result'] === STATUS.SKIPPED) {
              collection['@_skipped']++
              collection['@_total']++
            }
            if (_test['@_result'] === STATUS.FAILED) {
              collection['@_failed']++
              collection['@_total']++
            }
            if (_test['@_result'] === STATUS.PASSED) {
              collection['@_passed']++
              collection['@_total']++
            }
            addTime(collection, _test)
          })
        }
        if (this._options.xrayReport) {
          if (!tests) {
            return
          }
          collection.test = tests.filter((_test) => {
            if (!_test.traits || !_test.traits.trait) {
              return false
            }
            return _test.traits.trait.some((t) => t['@_name'] === 'test')
          })
        }
        return collection
      })
      .filter((c) => !!c)
    const rootCollection = filteredCollections[0]
    if (!rootCollection) {
      throw new NoCollectionError()
    }
    const report = {
      assemblies: {
        assembly: {
          '@_name': ((_a = this._options.assemblyName), _a !== null && _a !== void 0 ? _a : 'Mocha Tests'),
          '@_total': rootCollection['@_total'],
          '@_failed': rootCollection['@_failed'],
          '@_skipped': rootCollection['@_skipped'],
          '@_passed': rootCollection['@_passed'],
          '@_time': rootCollection['@_time'],
          '@_run-date': stats.start.toISOString().split('T')[0],
          '@_run-time': stats.start
            .toISOString()
            .split('T')[1]
            .split('.')[0],
          collection: this._options.xrayReport ? collections.filter((c) => c.test && c.test.length > 0) : collections,
        },
      },
    }
    return new parser.j2xParser(DEFAULT_PARSER_OPTIONS).parse(report)
  }
  writeXmlToDisk(xml, filePath) {
    if (filePath) {
      if (this._options.xrayReport) {
        debug('Attempting to combine output...')
        try {
          const previousReport = parser.parse(fs_1.default.readFileSync(filePath, 'utf-8'), DEFAULT_PARSER_OPTIONS)
          const currentReport = parser.parse(xml, DEFAULT_PARSER_OPTIONS)
          combine('previousReport:', JSON.stringify(previousReport, null, 2))
          combine('currentReport:', JSON.stringify(currentReport, null, 2))
          const previous = previousReport.assemblies.assembly
          const current = currentReport.assemblies.assembly
          if (Array.isArray(previous.collection)) {
            previous.collection.push(...(Array.isArray(current.collection) ? current.collection : [current.collection]))
          } else {
            previous.collection = [
              previous.collection,
              ...(Array.isArray(current.collection) ? current.collection : [current.collection]),
            ]
          }
          xml = new parser.j2xParser(DEFAULT_PARSER_OPTIONS).parse(previousReport)
          debug('combined output into:', filePath)
        } catch (e) {
          combine('error:', e)
          debug('nothing to combine, continuing...')
        }
      } else if (!this._options.xrayReport && filePath.indexOf('[hash]') !== -1) {
        filePath = filePath.replace('[hash]', md5_1.default(xml))
      }
      mkdirp_1.default.sync(path_1.default.dirname(filePath))
      try {
        fs_1.default.writeFileSync(filePath, '<?xml version="1.0" encoding="utf-8"?>' + xml, 'utf-8')
      } catch (exc) {
        console.error('problem writing results: ' + exc)
      }
    }
  }
}
module.exports = XUnitMochaReporter
