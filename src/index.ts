import Runner = Mocha.Runner
import MochaOptions = Mocha.reporters.XUnit.MochaOptions
import { reporters } from 'mocha'

import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import md5 from 'md5'

const debug = require('debug')('xunit-mocha-reporter:tests')
const xml = require('xml')
const stripAnsi = require('strip-ansi')

enum STATUS {
  PASSED = 'Pass',
  FAILED = 'Fail',
  SKIPPED = 'Skip',
}

// A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets that can occur in e.g. stacktraces
const INVALID_CHARACTERS = ['\u001b']

function configureDefaults(options?: MochaOptions) {
  const { reporterOptions } = options ?? {}

  return {
    mochaFile: process.env.MOCHA_FILE || 'test-results.xml',
    toConsole: false,
    assemblyName: 'Mocha Tests',
    addTags: false,
    ...reporterOptions,
  }
}

function isInvalidSuite(suite: Mocha.Suite) {
  return (
    (!suite.root && !suite.title) ||
    (suite.tests.length === 0 && suite.suites.length === 0)
  )
}

/**
 * Parses title for tags in format @tagName=value
 * @param {} testTitle
 */
function getTags(testTitle: string) {
  const regexAllTags = /@[A-Za-z]+=(?:"[\w\d\s-]+"|'[\w\d\s-]+'|[\w\d-]+)/gi
  const regexTag = /@([A-Za-z]+)=(?:"([\w\d\s-]+)"|'([\w\d\s-]+)'|([\w\d-]+))/i

  const result = {
    tags: {} as { [K in keyof TestAttrs]: string },
    cleanTitle: testTitle,
    tagsFound: false,
  }

  const foundTags = testTitle.match(regexAllTags)

  if (foundTags && foundTags.length > 0) {
    result.tagsFound = true
    foundTags.forEach((tag) => {
      const [, key, value] =
        tag.match(regexTag)?.filter((part) => {
          return part !== undefined
        }) ?? []

      result.cleanTitle = result.cleanTitle.replace(tag, '')
      if (key) {
        result.tags[key as keyof TestAttrs] = value
      }
    })
  }

  result.cleanTitle = result.cleanTitle.trim()

  return result
}

interface TestAttrs {
  name: string
  type: string
  method: string
  time: number
  result: STATUS.PASSED | STATUS.FAILED | STATUS.SKIPPED
}

interface TraitsXML {
  traits: [
    {
      trait: [{ _attr: { name: keyof TestAttrs; value: string } }]
    }
  ]
}

interface TestXML {
  test: [
    {
      _attr: TestAttrs
    },
    TraitsXML?
  ]
}

interface CollectionXML {
  collection: [
    {
      _attr: {
        name: string
        time: number
        total: number
        passed: number
        failed: number
        skipped: number
      }
    },
    (TestXML | CollectionXML)?,
    TraitsXML?
  ]
}

/**
 * XUnit reporter for mocha.js.
 * @module xunit-mocha-reporter
 * @param {EventEmitter} runner - the test runner
 * @param {Object} options - mocha options
 */
class XUnitMochaReporter extends reporters.Base {
  _options: any
  _runner: any

  collections: CollectionXML[] = []
  collectionQueue: CollectionXML[] = []

  constructor(runner: Runner, options: MochaOptions) {
    super(runner, options)

    debug('initializing XUnitMochaReporter with options:', options)

    this._options = configureDefaults(options)
    this._runner = runner

    // remove old results
    this._runner.on('start', () => {
      if (fs.existsSync(this._options.mochaFile)) {
        fs.unlinkSync(this._options.mochaFile)
      }
    })

    this._runner.on('suite', (suite: Mocha.Suite) => {
      if (isInvalidSuite(suite)) {
        debug('suite is invalid:', suite)
      } else {
        debug(
          'running suite:',
          suite?.title || (suite.root ? '[Root suite]' : '[Unknown suite]')
        )
        const collection = this.getCollectionData(suite)
        this.collections.push(collection)
        this.collectionQueue.push(collection)
      }
    })

    this._runner.on('suite end', (suite: Mocha.Suite) => {
      debug(
        'completed suite:',
        suite?.title || (suite.root ? '[Root suite]' : '[Unknown suite]')
      )
      this.collectionQueue.pop()
    })

    this._runner.on('pass', (test: Mocha.Test) => {
      debug('test passed:', test.title)
      this.lastCollection().push(this.getTestData(test, STATUS.PASSED))
    })

    this._runner.on('fail', (test: Mocha.Test) => {
      debug('test failed:', test.title)
      this.lastCollection().push(this.getTestData(test, STATUS.FAILED))
    })

    if (this._options.includePending) {
      this._runner.on('pending', (test: Mocha.Test) => {
        debug('test pending:', test.title)
        this.lastCollection().push(this.getTestData(test, STATUS.SKIPPED))
      })
    }

    this._runner.on('end', () => {
      debug('run complete')
      this.flush(this.collections)
    })
  }

  getCollectionData(suite: Mocha.Suite): CollectionXML {
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

  getTestData(test: Mocha.Test, status?: STATUS) {
    let name = stripAnsi(test.title)

    let tagResult: ReturnType<typeof getTags> | undefined
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
    } as TestXML

    if (tagResult && tagResult.tags) {
      testCase.test.push(({
        // assign the initial traits information
        traits: [],
      } as unknown) as TraitsXML)
      ;(Object.keys(tagResult.tags) as Array<keyof TestAttrs>).forEach(
        (tagName) => {
          let tagValue = ''
          if (tagResult!.tags[tagName]) {
            tagValue = tagResult!.tags[tagName]
          }
          const [, traits] = testCase.test
          traits!.traits.push({
            trait: [
              {
                _attr: {
                  name: tagName,
                  value: tagValue,
                },
              },
            ],
          })
        }
      )
    }

    return testCase
  }

  lastCollection() {
    return this.collectionQueue.slice(-1)[0].collection
  }

  // noinspection JSUnusedGlobalSymbols
  removeInvalidCharacters = (input: string) => {
    return INVALID_CHARACTERS.reduce(
      (text, invalidCharacter) =>
        text.replace(new RegExp(invalidCharacter, 'g'), ''),
      input
    )
  }

  flush(collections: CollectionXML[]) {
    const xml = this.getXml(collections)

    this.writeXmlToDisk(xml, this._options.mochaFile)

    if (this._options.toConsole) {
      console.log(xml) // eslint-disable-line no-console
    }
  }

  getXml(collections: CollectionXML[]): string {
    const isTest = (test: any): test is TestXML => {
      return (test as TestXML).test !== undefined
    }

    const isCollection = (collection: any): collection is CollectionXML => {
      return (collection as CollectionXML).collection !== undefined
    }

    const addTime = (a: { time: number }, b: { time: number }) => {
      a.time *= 1000 // convert time to milliseconds
      a.time += b.time * 1000 // then add (by mutating the time object)
      a.time /= 1000 // then convert back to seconds
    }

    const stats = this._runner.stats

    const summarizeCollection = (
      collection: CollectionXML,
      parent?: CollectionXML
    ) => {
      const [{ _attr: collectionAttrs }, ...items] = collection.collection

      collectionAttrs.failed = 0
      collectionAttrs.passed = 0
      collectionAttrs.total = 0
      collectionAttrs.time = 0
      collectionAttrs.skipped = 0

      items.forEach((item) => {
        if (isTest(item)) {
          if (item!.test[0]._attr.result === STATUS.SKIPPED) {
            collectionAttrs.skipped++
            collectionAttrs.total++
          }
          if (item!.test[0]._attr.result === STATUS.FAILED) {
            collectionAttrs.failed++
            collectionAttrs.total++
          }
          if (item!.test[0]._attr.result === STATUS.PASSED) {
            collectionAttrs.passed++
            collectionAttrs.total++
          }

          addTime(collectionAttrs, item!.test[0]._attr)
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

  writeXmlToDisk(xml: string, filePath: string) {
    if (filePath) {
      if (filePath.indexOf('[hash]') !== -1) {
        filePath = filePath.replace('[hash]', md5(xml))
      }

      mkdirp.sync(path.dirname(filePath))

      try {
        fs.writeFileSync(filePath, xml, 'utf-8')
      } catch (exc) {
        // eslint-disable-next-line no-console
        console.error('problem writing results: ' + exc)
      }
    }
  }
}

module.exports = XUnitMochaReporter
