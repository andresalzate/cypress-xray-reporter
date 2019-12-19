'use-strict';

const xml = require('xml');
const Base = require('mocha').reporters.Base;
const fs = require('fs');
const path = require('path');
const debug = require('debug')('mocha-xunit-reporter');
const mkdirp = require('mkdirp');
const md5 = require('md5');
const stripAnsi = require('strip-ansi');

const STATUS = {
  PASSED: 'pass',
  FAILED: 'fail',
  SKIPPED: 'skip',
};

module.exports = MochaXUnitReporter;

// A subset of invalid characters as defined in http://www.w3.org/TR/xml/#charsets that can occur in e.g. stacktraces
const INVALID_CHARACTERS = ['\u001b'];

function configureDefaults(options) {
  debug(options);
  options = options || {};
  options = options.reporterOptions || {};
  options.mochaFile =
    options.mochaFile || process.env.MOCHA_FILE || 'test-results.xml';
  options.toConsole = !!options.toConsole;
  options.assemblyName = options.assemblyName || 'Mocha Tests';
  options.addTags = options.addTags || false;

  return options;
}

function isInvalidSuite(suite) {
  return (
    (!suite.root && suite.title === '') ||
    (suite.tests.length === 0 && suite.suites.length === 0)
  );
}

/**
 * Parses title for tags in format @tagName=value
 * @param {} testTitle
 */
function getTags(testTitle) {
  const regexAllTags = /@[A-Za-z]+=(?:"[\w\d\s\-]+"|'[\w\d\s\-]+'|[\w\d\-]+)/gi;
  const regexTag = /@([A-Za-z]+)=(?:"([\w\d\s\-]+)"|'([\w\d\s\-]+)'|([\w\d\-]+))/i;

  const result = {
    tags: {},
    cleanTitle: testTitle,
    tagsFound: false,
  };

  const foundTags = testTitle.match(regexAllTags);

  if (foundTags && foundTags.length > 0) {
    result.tagsFound = true;
    foundTags.forEach(tag => {
      const parts = tag.match(regexTag).filter(part => {
        return part !== undefined;
      });

      result.cleanTitle = result.cleanTitle.replace(tag, '');
      if (parts.length > 0) {
        result.tags[parts[1]] = parts[2];
      }
    });
  }

  result.cleanTitle = result.cleanTitle.trim();

  return result;
}

/**
 * XUnit reporter for mocha.js.
 * @module mocha-xunit-reporter
 * @param {EventEmitter} runner - the test runner
 * @param {Object} options - mocha options
 */
function MochaXUnitReporter(runner, options) {
  this._options = configureDefaults(options);
  this._runner = runner;

  const collections = [];

  function lastCollection() {
    return collections[collections.length - 1].collection;
  }

  // get functionality from the Base reporter
  Base.call(this, runner);

  // remove old results
  this._runner.on(
    'start',
    function() {
      if (fs.existsSync(this._options.mochaFile)) {
        debug('removing report file', this._options.mochaFile);
        fs.unlinkSync(this._options.mochaFile);
      }
    }.bind(this),
  );

  this._runner.on(
    'suite',
    function(suite) {
      if (!isInvalidSuite(suite)) {
        collections.push(this.getCollectionData(suite));
      }
    }.bind(this),
  );

  this._runner.on(
    'pass',
    function(test) {
      lastCollection().push(this.getTestData(test, STATUS.PASSED));
    }.bind(this),
  );

  this._runner.on(
    'fail',
    function(test, err) {
      lastCollection().push(this.getTestData(test, STATUS.FAILED));
    }.bind(this),
  );

  if (this._options.includePending) {
    this._runner.on(
      'pending',
      function(test) {
        var test = this.getTestData(test, STATUS.SKIPPED);
        lastCollection().push(test);
      }.bind(this),
    );
  }

  this._runner.on(
    'end',
    function() {
      this.flush(collections);
    }.bind(this),
  );
}

/**
 * Produces an xml node for a test suite
 * @param  {Object} suite - a test suite
 * @return {Object}       - an object representing the xml node
 */
MochaXUnitReporter.prototype.getCollectionData = function(suite) {
  var collection = {
    collection: [
      {
        _attr: {
          name: suite.title || 'Root Suite',
          total: suite.tests.length,
        },
      },
    ],
  };

  return collection;
};

/**
 * Produces an xml config for a given test case.
 * @param {object} test - test case
 * @param {object} err - if test failed, the failure object
 * @returns {object}
 */
MochaXUnitReporter.prototype.getTestData = function(test, status) {
  let name = stripAnsi(test.fullTitle());

  let tagResult = null;
  if (this._options.addTags) {
    tagResult = getTags(name);
    if (tagResult.tagsFound) {
      name = stripAnsi(tagResult.cleanTitle);
    }
  }

  const testCase = {
    test: [
      {
        _attr: {
          name: name,
          time: typeof test.duration === 'undefined' ? 0 : test.duration / 1000,
          result: status,
        },
      },
    ],
  };

  if (tagResult && tagResult.tags) {
    testCase.test[1] = {
      // assign the initial traits information
      traits: [],
    };
    Object.keys(tagResult.tags).forEach(tagName => {
      let tagValue = '';
      if (tagResult.tags[tagName]) {
        tagValue = tagResult.tags[tagName];
      }
      testCase.test[0]._attr[tagName] = tagValue;
      testCase.test[1].traits.push({
        trait: {
          _attr: {
            name: tagName,
            value: tagValue,
          },
        },
      });
    });
  }

  return testCase;
};

/**
 * @param {string} input
 * @returns {string} without invalid characters
 */
MochaXUnitReporter.prototype.removeInvalidCharacters = function(input) {
  return INVALID_CHARACTERS.reduce(function(text, invalidCharacter) {
    return text.replace(new RegExp(invalidCharacter, 'g'), '');
  }, input);
};

/**
 * Writes xml to disk and ouputs content if "toConsole" is set to true.
 * @param {Array.<Object>} testsuites - a list of xml configs
 */
MochaXUnitReporter.prototype.flush = function(collections) {
  const xml = this.getXml(collections);

  this.writeXmlToDisk(xml, this._options.mochaFile);

  if (this._options.toConsole === true) {
    console.log(xml); // eslint-disable-line no-console
  }
};

/**
 * Produces an XML string from the given test data.
 * @param {Array.<Object>} testsuites - a list of xml configs
 * @returns {string}
 */
MochaXUnitReporter.prototype.getXml = function(collections) {
  const stats = this._runner.stats;

  let totalSuitesTime = 0;
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  collections.forEach(function(collection) {
    const _collAttr = collection.collection[0]._attr;
    const _cases = collection.collection.slice(1);

    _collAttr.failed = 0;
    _collAttr.passed = 0;
    _collAttr.total = 0;
    _collAttr.time = 0;
    _collAttr.skipped = 0;

    _cases.forEach(function(test) {
      if (test.test[0]._attr.result === STATUS.SKIPPED) {
        _collAttr.skipped++;
      }
      if (test.test[0]._attr.result === STATUS.FAILED) {
        _collAttr.failed++;
      }
      if (test.test[0]._attr.result === STATUS.PASSED) {
        _collAttr.passed++;
      }
      _collAttr.time += test.test[0]._attr.time;
    });

    _collAttr.total = _collAttr.skipped + _collAttr.failed + _collAttr.passed;

    totalSuitesTime += _collAttr.time;
    totalTests += _collAttr.total;
    totalPassed += _collAttr.passed;
    totalSkipped += _collAttr.skipped;
    totalFailed += _collAttr.failed;
  });

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
    ].concat(collections),
  };

  return xml(
    {
      assemblies: [assembly],
    },
    { declaration: true, indent: '  ' },
  );
};

/**
 * Writes a XUnit test report XML document.
 * @param {string} xml - xml string
 * @param {string} filePath - path to output file
 */
MochaXUnitReporter.prototype.writeXmlToDisk = function(xml, filePath) {
  if (filePath) {
    if (filePath.indexOf('[hash]') !== -1) {
      filePath = filePath.replace('[hash]', md5(xml));
    }

    debug('writing file to', filePath);
    mkdirp.sync(path.dirname(filePath));

    try {
      fs.writeFileSync(filePath, xml, 'utf-8');
    } catch (exc) {
      debug('problem writing results: ' + exc);
    }
    debug('results written successfully');
  }
};
