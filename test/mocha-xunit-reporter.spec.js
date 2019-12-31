/* eslint-env mocha */
'use-strict'

const Reporter = require('../dist')
const Runner = require('./helpers/mock-runner')
const Test = require('./helpers/mock-test')

const fs = require('fs')
const path = require('path')

const chai = require('chai')
const expect = chai.expect
const chaiXML = require('chai-xml')
const mockXml = require('./mock-results')
const testConsole = require('test-console')

const debug = require('debug')('xunit-mocha-reporter:tests')

chai.use(chaiXML)

describe('xunit-mocha-reporter', () => {
  let runner
  let filePath
  let MOCHA_FILE

  function executeTestRunner(options) {
    options = options || {}
    options.invalidChar = options.invalidChar || ''
    options.title = options.title || 'Foo Bar module'
    options.root = typeof options.root !== 'undefined' ? options.root : false
    runner.start()

    const mainSuite = {
      title: options.title,
      root: options.root,
      tests: [1, 2],
    }
    runner.startSuite(mainSuite)

    if (!options.skipPassedTests) {
      runner.pass(new Test('Foo can weez the juice', 'can weez the juice', 1))
    }

    const { invalidChar } = options

    runner.fail(
      new Test('Bar can narfle the garthog', 'can narfle the garthog', 1),
      { stack: invalidChar + 'expected garthog to be dead' + invalidChar }
    )

    runner.fail(
      new Test('Baz can behave like a flandip', 'can behave like a flandip', 1),
      {
        name: 'BazError',
        message:
          'expected baz to be masher, a hustler, an uninvited grasper of cone',
      }
    )
    const anotherSuite = {
      title: 'Another suite!',
      tests: [1],
    }
    runner.startSuite(anotherSuite)
    runner.pass(new Test('Another suite', 'works', 4))
    runner.endSuite(anotherSuite)

    if (options && options.includePending) {
      const pendingSuite = {
        title: 'Pending suite!',
        tests: [1],
      }
      runner.startSuite(pendingSuite)
      runner.pending(new Test('Pending suite', 'pending'))
      runner.endSuite(pendingSuite)
    }

    runner.endSuite(mainSuite)

    runner.end()
  }

  function verifyMochaFile(path, options) {
    const now = new Date().toISOString()
    debug('verify', now)
    const output = fs.readFileSync(path, 'utf-8')
    expect(output).xml.to.be.valid()
    expect(output).xml.to.equal(mockXml(runner.stats, options))
    fs.unlinkSync(path)
    debug('done', now)
  }

  function removeTestPath() {
    const testPath = '/subdir/foo/mocha.xml'
    const parts = testPath.slice(1).split('/')

    parts.reduce((testPath) => {
      if (fs.existsSync(__dirname + testPath)) {
        const removeFile =
          testPath.indexOf('.') === -1 ? 'rmdirSync' : 'unlinkSync'
        fs[removeFile](__dirname + testPath)
      }

      return path.dirname(testPath)
    }, testPath)
  }

  function createReporter(options) {
    options = options || {}
    filePath = path.join(path.dirname(__dirname), options.mochaFile || '')

    return new Reporter(runner, { reporterOptions: options })
  }

  function getFileNameWithHash(path) {
    const filenames = fs.readdirSync(path)
    const expected = /(^results\.)([a-f0-9]{32})(\.xml)$/i

    for (let i = 0; i < filenames.length; i++) {
      if (expected.test(filenames[i])) {
        return filenames[i]
      }
    }
  }

  before(() => {
    // cache this
    MOCHA_FILE = process.env.MOCHA_FILE
  })

  after(() => {
    // reset this
    process.env.MOCHA_FILE = MOCHA_FILE
  })

  beforeEach(() => {
    runner = new Runner()
    filePath = undefined
    delete process.env.MOCHA_FILE
    delete process.env.PROPERTIES
  })

  afterEach(() => {
    debug('after')
  })

  it('can produce a XUnit XML report', () => {
    createReporter({ mochaFile: 'test/mocha.xml' })
    executeTestRunner()

    verifyMochaFile(filePath)
  })

  it('respects `process.env.MOCHA_FILE`', () => {
    process.env.MOCHA_FILE = 'test/results.xml'
    createReporter()
    executeTestRunner()

    verifyMochaFile(process.env.MOCHA_FILE)
  })

  it('respects `--reporter-options mochaFile=`', () => {
    createReporter({ mochaFile: 'test/results.xml' })
    executeTestRunner()

    verifyMochaFile(filePath)
  })

  it('respects `[hash]` pattern in test results report filename', () => {
    const dir = 'test/'
    const path = dir + 'results.[hash].xml'
    createReporter({ mochaFile: path })
    executeTestRunner()
    verifyMochaFile(dir + getFileNameWithHash(dir))
  })

  it('will create intermediate directories', () => {
    createReporter({ mochaFile: 'test/subdir/foo/mocha.xml' })
    removeTestPath()
    executeTestRunner()

    verifyMochaFile(filePath)
    removeTestPath()
  })

  it('creates valid XML report for invalid message', () => {
    createReporter({ mochaFile: 'test/mocha.xml' })
    executeTestRunner({ invalidChar: '\u001b' })

    verifyMochaFile(filePath)
  })

  it('outputs skipped tests if "includePending" is specified', () => {
    createReporter({ mochaFile: 'test/mocha.xml', includePending: true })
    executeTestRunner({ includePending: true })

    verifyMochaFile(filePath)
  })

  it('can output to the console', () => {
    createReporter({ mochaFile: 'test/console.xml', toConsole: true })

    const stdout = testConsole.stdout.inspect()
    try {
      executeTestRunner()
      verifyMochaFile(filePath)
    } catch (e) {
      stdout.restore()
      throw e
    }

    stdout.restore()

    const xml = stdout.output[0]
    expect(xml).xml.to.be.valid()
    expect(xml).xml.to.equal(mockXml(runner.stats))
  })

  describe('Output', () => {
    let reporter, assembly

    beforeEach(() => {
      reporter = spyingReporter()
    })

    it('skips suites with empty title', () => {
      runner.startSuite({ title: '', tests: [1] })
      runner.end()

      expect(assembly).to.be.empty
    })

    it('skips suites without testcases and suites', () => {
      runner.startSuite({ title: 'test me' })
      runner.end()

      expect(assembly).to.be.empty
    })

    it('does not skip suites with nested suites', () => {
      runner.startSuite({ title: 'test me', suites: [1] })
      runner.end()

      expect(assembly).to.have.length(1)
    })

    it('does not skip suites with nested tests', () => {
      runner.startSuite({ title: 'test me', tests: [1] })
      runner.end()

      expect(assembly).to.have.length(1)
    })

    it('does not skip root suite', () => {
      runner.startSuite({ title: '', root: true, suites: [1] })
      runner.end()

      expect(assembly).to.have.length(1)
    })

    it('uses "Root Suite" by default', () => {
      runner.startSuite({ title: '', root: true, suites: [1] })
      runner.end()
      expect(assembly[0].collection[0]._attr).to.have.property(
        'name',
        'Root Suite'
      )
    })

    function spyingReporter(options) {
      options = options || {}
      options.mochaFile = options.mochaFile || 'test/mocha.xml'

      reporter = createReporter(options)

      reporter.flush = (suites) => {
        assembly = suites
      }

      return reporter
    }
  })

  describe('Feature "Configurable addTags"', () => {
    let reporter
    const mockedTestCase = {
      title: '@test=WWW-123 should behave like so',
      pending: false,
      type: 'test',
      body: '',
      duration: 1682,
      state: 'passed',
      parent: {
        title: 'RBAPI token @requirement=WWW-123',
        ctx: {},
        suites: [],
        tests: [],
        pending: false,
        root: false,
        delayed: false,
        parent: {
          title: '',
          ctx: {},
          suites: [],
          tests: [],
          pending: false,
          root: true,
          delayed: false,
          id: 'r1',
          type: 'suite',
        },
        id: 'r2',
        type: 'suite',
      },
      id: 'r3',
      wallClockStartedAt: '2019-12-20T14:42:07.186Z',
      timings: {
        lifecycle: 40,
        test: {
          fnDuration: 1642,
          afterFnDuration: 0,
        },
      },
      speed: 'slow',
    }

    mockedTestCase.parent.tests.push(mockedTestCase)
    mockedTestCase.parent.parent.suites.push(mockedTestCase.parent)

    const validateTestCase = (testCase) => {
      expect(testCase.test[1].traits[0].trait[0]._attr.name).to.equal('aid')
      expect(testCase.test[1].traits[1].trait[0]._attr.name).to.equal('sid')
      expect(testCase.test[1].traits[2].trait[0]._attr.name).to.equal('type')
    }

    it('should generate attributes for addTags=true and tags in test title', () => {
      const modTestCase = { ...mockedTestCase }
      modTestCase.title =
        'should behave like so @aid=EPM-DP-C1234 @sid=EPM-1234 @type=Integration'
      reporter = createReporter({ mochaFile: 'test/mocha.xml', addTags: true })
      const testCase = reporter.getTestData(modTestCase)
      expect(testCase.test[0]._attr.name).to.equal('should behave like so')
      expect(testCase.test[1].traits[0].trait[0]._attr.value).to.equal(
        'EPM-DP-C1234'
      )
      expect(testCase.test[1].traits[1].trait[0]._attr.value).to.equal(
        'EPM-1234'
      )
      expect(testCase.test[1].traits[2].trait[0]._attr.value).to.equal(
        'Integration'
      )
      validateTestCase(testCase)
    })

    it('should generate attributes for addTags=true and tags in test title in quotes', () => {
      const modTestCase = { ...mockedTestCase }
      modTestCase.title =
        'should behave like so @aid="test TAG 1" @sid=\'TEST tag 2\' @type=Integration'
      reporter = createReporter({ mochaFile: 'test/mocha.xml', addTags: true })
      const testCase = reporter.getTestData(modTestCase)
      expect(testCase.test[0]._attr.name).to.equal('should behave like so')
      expect(testCase.test[1].traits[0].trait[0]._attr.value).to.equal(
        'test TAG 1'
      )
      expect(testCase.test[1].traits[1].trait[0]._attr.value).to.equal(
        'TEST tag 2'
      )
      expect(testCase.test[1].traits[2].trait[0]._attr.value).to.equal(
        'Integration'
      )
      validateTestCase(testCase)
    })

    it('should still work for addTags=true and tags NOT in test title', () => {
      reporter = createReporter({ mochaFile: 'test/mocha.xml', addTags: true })
      const testCase = reporter.getTestData(mockedTestCase)
      expect(testCase.test[0]._attr.name).to.equal('should behave like so')
    })

    it('should generate traits for addTags=true and tags in test title', () => {
      const modTestCase = { ...mockedTestCase }
      modTestCase.title =
        'should behave like so @aid=EPM-DP-C1234 @sid=EPM-1234 @type=Integration'
      reporter = createReporter({ mochaFile: 'test/mocha.xml', addTags: true })
      const testCase = reporter.getTestData(modTestCase)
      expect(testCase.test[1].traits[0].trait[0]._attr['name']).to.equal('aid')
      expect(testCase.test[1].traits[0].trait[0]._attr['value']).to.equal(
        'EPM-DP-C1234'
      )
      expect(testCase.test[1].traits[1].trait[0]._attr['name']).to.equal('sid')
      expect(testCase.test[1].traits[1].trait[0]._attr['value']).to.equal(
        'EPM-1234'
      )
      expect(testCase.test[1].traits[2].trait[0]._attr['name']).to.equal('type')
      expect(testCase.test[1].traits[2].trait[0]._attr['value']).to.equal(
        'Integration'
      )
    })

    it('should generate traits for addTags=true and tags in test title in quotes', () => {
      const modTestCase = { ...mockedTestCase }
      modTestCase.title =
        'should behave like so @aid="test TAG 1" @sid=\'TEST tag 2\' @type=Integration'
      reporter = createReporter({ mochaFile: 'test/mocha.xml', addTags: true })
      const testCase = reporter.getTestData(modTestCase)
      expect(testCase.test[1].traits[0].trait[0]._attr['name']).to.equal('aid')
      expect(testCase.test[1].traits[0].trait[0]._attr['value']).to.equal(
        'test TAG 1'
      )
      expect(testCase.test[1].traits[1].trait[0]._attr['name']).to.equal('sid')
      expect(testCase.test[1].traits[1].trait[0]._attr['value']).to.equal(
        'TEST tag 2'
      )
      expect(testCase.test[1].traits[2].trait[0]._attr['name']).to.equal('type')
      expect(testCase.test[1].traits[2].trait[0]._attr['value']).to.equal(
        'Integration'
      )
    })
  })
})
