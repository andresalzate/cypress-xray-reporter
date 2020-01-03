import Runner = Mocha.Runner
import MochaOptions = Mocha.reporters.XUnit.MochaOptions
import { reporters } from 'mocha'

import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import md5 from 'md5'

const debug = require('debug')('cypress-xray-reporter'),
  combine = require('debug')('cypress-xray-reporter:combine'),
  xray = require('debug')('cypress-xray-reporter:xray')
const parser = require('fast-xml-parser')
const stripAnsi = require('strip-ansi')

enum STATUS {
  PASSED = 'Pass',
  FAILED = 'Fail',
  SKIPPED = 'Skip',
}

class NoCollectionError extends Error {
  message = 'No collections remain after filtering'
}

// A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets that can occur in e.g. stacktraces
const INVALID_CHARACTERS = ['\u001b']
const DEFAULT_PARSER_OPTIONS = { ignoreAttributes: false }

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
  return (!suite.root && !suite.title) || (suite.tests.length === 0 && suite.suites.length === 0)
}

/**
 * Parses title for tags in format @tagName=value
 * @param {} testTitle
 */
function getTags(testTitle: string) {
  const regexAllTags = /@[A-Za-z]+=(?:"[\w\d\s-]+"|'[\w\d\s-]+'|[\w\d-]+)/gi
  const regexTag = /@([A-Za-z]+)=(?:"([\w\d\s-]+)"|'([\w\d\s-]+)'|([\w\d-]+))/i

  const result = {
    tags: {} as any,
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
        result.tags[key] = value
      }
    })
  }

  result.cleanTitle = result.cleanTitle.trim()

  return result
}

interface RunInfoAttrs {
  '@_name': string
  '@_total': number
  '@_failed': number
  '@_skipped': number
  '@_passed': number
  '@_time': number
}

interface TestAttrs {
  '@_name': string
  '@_time': number
  '@_result': STATUS.PASSED | STATUS.FAILED | STATUS.SKIPPED

  '@_method'?: string
  '@_type'?: string
}

interface TraitXML {
  '@_name': string
  '@_value': string
}

interface TestXML extends TestAttrs {
  traits?: { trait: TraitXML[] }
}

interface CollectionXML extends RunInfoAttrs {
  test: TestXML[]
}

interface AssemblyXML extends RunInfoAttrs {
  '@_run-date': string
  '@_run-time': string
  collection: CollectionXML[]
}

interface ReportXML {
  assemblies: {
    assembly: AssemblyXML
  }
}

interface XUnitMochaReporterOptions {
  // configures the file to write reports to
  mochaFile: string
  // if set to a truthy value will parse the test title for tags
  addTags?: boolean
  // the name for the assembly element (default: 'Mocha Tests')
  assemblyName?: string
  // if truthy, generate XRay-compatible report
  xrayReport?: boolean
  // if set to a truthy value pending tests will be included in the report
  includePending?: boolean
  // if set to a truthy value the produced XML will be logged to the console
  toConsole?: boolean
}

/**
 * Cypress XRay Reporter for mocha.js.
 * @module cypress-xray-reporter
 * @param {EventEmitter} runner - the test runner
 * @param {Object} options - mocha options
 */
class XUnitMochaReporter extends reporters.Base {
  _options: XUnitMochaReporterOptions
  _runner: Mocha.Runner

  // used to track the "place in the collection stack" we are in
  _collectionQueue: CollectionXML[] = []
  collections: CollectionXML[] = []

  constructor(runner: Runner, options: MochaOptions) {
    super(runner, options)

    debug('initializing XUnitMochaReporter with options:', options)

    this._options = configureDefaults(options)
    this._runner = runner

    // remove old results
    this._runner.on('start', () => {
      if (!this._options.xrayReport && fs.existsSync(this._options.mochaFile)) {
        fs.unlinkSync(this._options.mochaFile)
      }
    })

    this._runner.on('suite', (suite: Mocha.Suite) => {
      if (isInvalidSuite(suite)) {
        debug('suite is invalid:', suite)
      } else {
        debug('running suite:', suite?.title || (suite.root ? '[Root suite]' : '[Unknown suite]'))
        const collection = this.getCollectionData(suite)
        this.collections.push(collection)
        this._collectionQueue.push(collection)
      }
    })

    this._runner.on('suite end', (suite: Mocha.Suite) => {
      debug('completed suite:', suite?.title || (suite.root ? '[Root suite]' : '[Unknown suite]'))
      this._collectionQueue.pop()
    })

    this._runner.on('pass', (test: Mocha.Test) => {
      debug('test passed:', test.title)
      this.lastCollection().test.push(this.getTestData(test, STATUS.PASSED))
    })

    this._runner.on('fail', (test: Mocha.Test) => {
      debug('test failed:', test.title)
      this.lastCollection().test.push(this.getTestData(test, STATUS.FAILED))
    })

    if (this._options.includePending) {
      this._runner.on('pending', (test: Mocha.Test) => {
        debug('test pending:', test.title)
        this.lastCollection().test.push(this.getTestData(test, STATUS.SKIPPED))
      })
    }

    this._runner.on('end', () => {
      debug('run complete')
      this.flush(this.collections)
    })
  }

  getCollectionData(suite: Mocha.Suite): CollectionXML {
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

  getTestData(test: Mocha.Test, status: STATUS) {
    let name = stripAnsi(test.title)

    let tagResult: ReturnType<typeof getTags> | undefined
    if (this._options.addTags) {
      tagResult = getTags(name)
      if (tagResult.tagsFound) {
        name = stripAnsi(tagResult.cleanTitle)
      }
    }

    const testCase: TestXML = {
      '@_name': name,
      '@_time': typeof test.duration === 'undefined' ? 0 : test.duration / 1000,
      '@_result': status,
    }

    let allTags = {} as any

    this._collectionQueue.forEach((collection) => {
      const tagResult = getTags(collection['@_name'])
      if (tagResult && tagResult.tags) {
        allTags = { ...allTags, ...tagResult.tags }
      }
    })

    if (tagResult && tagResult.tags) {
      allTags = { ...allTags, ...tagResult.tags }
    }

    if (Object.keys(allTags).length > 0) {
      testCase.traits = { trait: [] }
      // loop over the attributes of TestAttrs (minus method and type)
      Object.keys(allTags).forEach((tagName) => {
        let tagValue = ''
        if (allTags[tagName]) {
          tagValue = allTags[tagName]
        }
        const traits = testCase.traits!
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

  // noinspection JSUnusedGlobalSymbols
  removeInvalidCharacters = (input: string) => {
    return INVALID_CHARACTERS.reduce(
      (text, invalidCharacter) => text.replace(new RegExp(invalidCharacter, 'g'), ''),
      input
    )
  }

  flush(collections: CollectionXML[]) {
    try {
      const xml = this.getXml(collections)
      this.writeXmlToDisk(xml, this._options.mochaFile)
      if (this._options.toConsole) {
        console.log(xml) // eslint-disable-line no-console
      }
    } catch (e) {
      if (typeof e === typeof NoCollectionError) {
        xray('all collections have been filtered out')
      }
    }
  }

  getXml(collections: CollectionXML[]): string {
    const addTime = (c: CollectionXML, t: CollectionXML | TestXML) => {
      c['@_time'] *= 1000 // convert time to milliseconds
      c['@_time'] += t['@_time'] * 1000 // then add (by mutating the time object)
      c['@_time'] /= 1000 // then convert back to seconds
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
      // remove empty collections
      .filter((c) => !!c) as CollectionXML[]

    const rootCollection = filteredCollections[0]

    if (!rootCollection) {
      throw new NoCollectionError()
    }

    const report: ReportXML = {
      assemblies: {
        assembly: {
          '@_name': this._options.assemblyName ?? 'Mocha Tests',
          '@_total': rootCollection['@_total'],
          '@_failed': rootCollection['@_failed'],
          '@_skipped': rootCollection['@_skipped'],
          '@_passed': rootCollection['@_passed'],
          '@_time': rootCollection['@_time'],
          '@_run-date': stats!.start!.toISOString().split('T')[0],
          '@_run-time': stats!
            .start!.toISOString()
            .split('T')[1]
            .split('.')[0],
          collection: this._options.xrayReport ? collections.filter((c) => c.test && c.test.length > 0) : collections,
        },
      },
    }

    return new parser.j2xParser(DEFAULT_PARSER_OPTIONS).parse(report)
  }

  writeXmlToDisk(xml: string, filePath: string) {
    if (filePath) {
      if (this._options.xrayReport) {
        debug('Attempting to combine output...')
        try {
          // combine the files
          const previousReport: ReportXML = parser.parse(fs.readFileSync(filePath, 'utf-8'), DEFAULT_PARSER_OPTIONS)
          const currentReport: ReportXML = parser.parse(xml, DEFAULT_PARSER_OPTIONS)

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
        filePath = filePath.replace('[hash]', md5(xml))
      }

      mkdirp.sync(path.dirname(filePath))

      try {
        fs.writeFileSync(filePath, '<?xml version="1.0" encoding="utf-8"?>' + xml, 'utf-8')
      } catch (exc) {
        // eslint-disable-next-line no-console
        console.error('problem writing results: ' + exc)
      }
    }
  }
}

module.exports = XUnitMochaReporter
