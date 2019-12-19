import Runner = Mocha.Runner
import MochaOptions = Mocha.reporters.XUnit.MochaOptions
import { reporters } from 'mocha'

import fs from 'fs'
import path from 'path'
import mkdirp from 'mkdirp'
import md5 from 'md5'

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
    (!suite.root && suite.title === '') ||
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
      _attr: Partial<{
        name: string
        time: number
        total: number
        passed: number
        failed: number
        skipped: number
      }>
    },
    TestXML?
  ]
}

/**
 * XUnit reporter for mocha.js.
 * @module mocha-xunit-reporter
 * @param {EventEmitter} runner - the test runner
 * @param {Object} options - mocha options
 */
class MochaXUnitReporter extends reporters.Base {
  _options: any
  _runner: any

  collections: CollectionXML[] = []

  constructor(runner: Runner, options: MochaOptions) {
    super(runner, options)

    this._options = configureDefaults(options)
    this._runner = runner

    // remove old results
    this._runner.on('start', () => {
      if (fs.existsSync(this._options.mochaFile)) {
        fs.unlinkSync(this._options.mochaFile)
      }
    })

    this._runner.on('suite', (suite: Mocha.Suite) => {
      if (!isInvalidSuite(suite)) {
        this.collections.push(this.getCollectionData(suite))
      }
    })

    this._runner.on('pass', (test: Mocha.Test) => {
      this.lastCollection().push(this.getTestData(test, STATUS.PASSED))
    })

    this._runner.on('fail', (test: Mocha.Test) => {
      this.lastCollection().push(this.getTestData(test, STATUS.FAILED))
    })

    if (this._options.includePending) {
      this._runner.on('pending', (test: Mocha.Test) => {
        this.lastCollection().push(this.getTestData(test, STATUS.SKIPPED))
      })
    }

    this._runner.on('end', () => {
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
          },
        },
      ],
    }
  }

  getTestData(test: Mocha.Test, status?: STATUS) {
    let name = stripAnsi(test.fullTitle())

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
            name: name,
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
        (tagName: keyof TestAttrs) => {
          let tagValue = ''
          if (tagResult!.tags[tagName]) {
            tagValue = tagResult!.tags[tagName]
          }
          const [{ _attr }, traits] = testCase.test
          // @ts-ignore
          _attr[tagName] = tagValue
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
    return this.collections[this.collections.length - 1].collection
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
    const stats = this._runner.stats

    let totalSuitesTime = 0
    let totalTests = 0
    let totalPassed = 0
    let totalFailed = 0
    let totalSkipped = 0

    collections.forEach((collection) => {
      const [{ _attr: _collAttr }, ..._cases] = collection.collection

      _collAttr.failed = 0
      _collAttr.passed = 0
      _collAttr.total = 0
      _collAttr.time = 0
      _collAttr.skipped = 0

      _cases.forEach((test) => {
        if (test!.test[0]._attr.result === STATUS.SKIPPED) {
          _collAttr.skipped!++
        }
        if (test!.test[0]._attr.result === STATUS.FAILED) {
          _collAttr.failed!++
        }
        if (test!.test[0]._attr.result === STATUS.PASSED) {
          _collAttr.passed!++
        }
        _collAttr.time! += test!.test[0]._attr.time!
      })

      _collAttr.total = _collAttr.skipped + _collAttr.failed + _collAttr.passed

      totalSuitesTime += _collAttr.time
      totalTests += _collAttr.total
      totalPassed += _collAttr.passed
      totalSkipped += _collAttr.skipped
      totalFailed += _collAttr.failed
    })

    const assembly = {
      assembly: [
        {
          _attr: {
            name: this._options.assemblyName,
            time: totalSuitesTime,
            total: totalTests,
            failed: totalFailed,
            passed: totalPassed,
            skipped: totalSkipped,
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

module.exports = MochaXUnitReporter
