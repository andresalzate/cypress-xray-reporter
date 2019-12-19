"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const mocha_1 = require("mocha");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const mkdirp_1 = __importDefault(require("mkdirp"));
const md5_1 = __importDefault(require("md5"));
const xml = require('xml');
const stripAnsi = require('strip-ansi');
var STATUS;
(function (STATUS) {
    STATUS["PASSED"] = "Pass";
    STATUS["FAILED"] = "Fail";
    STATUS["SKIPPED"] = "Skip";
})(STATUS || (STATUS = {}));
const INVALID_CHARACTERS = ['\u001b'];
function configureDefaults(options) {
    const { reporterOptions } = (options !== null && options !== void 0 ? options : {});
    return Object.assign({ mochaFile: process.env.MOCHA_FILE || 'test-results.xml', toConsole: false, assemblyName: 'Mocha Tests', addTags: false }, reporterOptions);
}
function isInvalidSuite(suite) {
    return ((!suite.root && suite.title === '') ||
        (suite.tests.length === 0 && suite.suites.length === 0));
}
function getTags(testTitle) {
    const regexAllTags = /@[A-Za-z]+=(?:"[\w\d\s-]+"|'[\w\d\s-]+'|[\w\d-]+)/gi;
    const regexTag = /@([A-Za-z]+)=(?:"([\w\d\s-]+)"|'([\w\d\s-]+)'|([\w\d-]+))/i;
    const result = {
        tags: {},
        cleanTitle: testTitle,
        tagsFound: false,
    };
    const foundTags = testTitle.match(regexAllTags);
    if (foundTags && foundTags.length > 0) {
        result.tagsFound = true;
        foundTags.forEach((tag) => {
            var _a, _b;
            const [, key, value] = (_b = (_a = tag.match(regexTag)) === null || _a === void 0 ? void 0 : _a.filter((part) => {
                return part !== undefined;
            }), (_b !== null && _b !== void 0 ? _b : []));
            result.cleanTitle = result.cleanTitle.replace(tag, '');
            if (key) {
                result.tags[key] = value;
            }
        });
    }
    result.cleanTitle = result.cleanTitle.trim();
    return result;
}
class MochaXUnitReporter extends mocha_1.reporters.Base {
    constructor(runner, options) {
        super(runner, options);
        this.collections = [];
        this.removeInvalidCharacters = (input) => {
            return INVALID_CHARACTERS.reduce((text, invalidCharacter) => text.replace(new RegExp(invalidCharacter, 'g'), ''), input);
        };
        this._options = configureDefaults(options);
        this._runner = runner;
        this._runner.on('start', () => {
            if (fs_1.default.existsSync(this._options.mochaFile)) {
                fs_1.default.unlinkSync(this._options.mochaFile);
            }
        });
        this._runner.on('suite', (suite) => {
            if (!isInvalidSuite(suite)) {
                this.collections.push(this.getCollectionData(suite));
            }
        });
        this._runner.on('pass', (test) => {
            this.lastCollection().push(this.getTestData(test, STATUS.PASSED));
        });
        this._runner.on('fail', (test) => {
            this.lastCollection().push(this.getTestData(test, STATUS.FAILED));
        });
        if (this._options.includePending) {
            this._runner.on('pending', (test) => {
                this.lastCollection().push(this.getTestData(test, STATUS.SKIPPED));
            });
        }
        this._runner.on('end', () => {
            this.flush(this.collections);
        });
    }
    getCollectionData(suite) {
        return {
            collection: [
                {
                    _attr: {
                        name: suite.title || 'Root Suite',
                        total: suite.tests.length,
                    },
                },
            ],
        };
    }
    getTestData(test, status) {
        let name = stripAnsi(test.fullTitle());
        let tagResult;
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
            testCase.test.push({
                traits: [],
            });
            Object.keys(tagResult.tags).forEach((tagName) => {
                let tagValue = '';
                if (tagResult.tags[tagName]) {
                    tagValue = tagResult.tags[tagName];
                }
                const [{ _attr }, traits] = testCase.test;
                _attr[tagName] = tagValue;
                traits.traits.push({
                    trait: [
                        {
                            _attr: {
                                name: tagName,
                                value: tagValue,
                            },
                        },
                    ],
                });
            });
        }
        return testCase;
    }
    lastCollection() {
        return this.collections[this.collections.length - 1].collection;
    }
    flush(collections) {
        const xml = this.getXml(collections);
        this.writeXmlToDisk(xml, this._options.mochaFile);
        if (this._options.toConsole) {
            console.log(xml);
        }
    }
    getXml(collections) {
        const stats = this._runner.stats;
        let totalSuitesTime = 0;
        let totalTests = 0;
        let totalPassed = 0;
        let totalFailed = 0;
        let totalSkipped = 0;
        collections.forEach((collection) => {
            const [{ _attr: _collAttr }, ..._cases] = collection.collection;
            _collAttr.failed = 0;
            _collAttr.passed = 0;
            _collAttr.total = 0;
            _collAttr.time = 0;
            _collAttr.skipped = 0;
            _cases.forEach((test) => {
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
                ...collections,
            ],
        };
        return xml({
            assemblies: [assembly],
        }, { declaration: true, indent: '  ' });
    }
    writeXmlToDisk(xml, filePath) {
        if (filePath) {
            if (filePath.indexOf('[hash]') !== -1) {
                filePath = filePath.replace('[hash]', md5_1.default(xml));
            }
            mkdirp_1.default.sync(path_1.default.dirname(filePath));
            try {
                fs_1.default.writeFileSync(filePath, xml, 'utf-8');
            }
            catch (exc) {
                console.error('problem writing results: ' + exc);
            }
        }
    }
}
module.exports = MochaXUnitReporter;
