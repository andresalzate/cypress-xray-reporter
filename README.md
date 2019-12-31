# xunit-mocha-reporter

A Mocha xunit reporter. Produces XUnit-style XML test results.
Adapted from and Inspired by [mocha-xunit-reporter](https://github.com/passuied/mocha-xunit-reporter)

## Installation

```bash
$ npm install xunit-mocha-reporter --save-dev
```

or as a global module

```bash
$ npm install -g xunit-mocha-reporter
```

## Usage

Run mocha with `xunit-mocha-reporter`:

```bash
$ mocha test --reporter xunit-mocha-reporter
```

This will output a results file at `./test-results.xml`.

You may optionally declare an alternate location for rexults XML file by setting the environment variable `MOCHA_FILE` or specifying `mochaFile` in `reporterOptions`:

```bash
$ MOCHA_FILE=./path_to_your/file.xml mocha test --reporter xunit-mocha-reporter
```

or

```bash
$ mocha test --reporter xunit-mocha-reporter --reporter-options mochaFile=./path_to_your/file.xml
```

or

```javascript
var mocha = new Mocha({
  reporter: 'xunit-mocha-reporter',
  reporterOptions: {
    mochaFile: './path_to_your/file.xml',
  },
})
```

### `addTags` option

- If set to true, will parse the test title for tags in format `@tagName=tagValue` and will add them as attributes of the test XML element AND as their own `<trait>` elements. It will also clean the outputted tags from the test name XML attribute.
- See example below:

```javascript
var mocha = new Mocha({
  reporter: 'xunit-mocha-reporter',
  reporterOptions: {
    mochaFile: './path_to_your/file.xml',
    addTags: true,
  },
})
```

Given a test with title

```javascript
'test should behave like so @aid=EPM-DP-C1234 @sid=EPM-1234 @type="Integration Type"'
```

the outputted test element will look as follows:

```xml
<test name="test should behave like so" aid="EPM-DP-C1234" sid="EPM-1234" type="Integration Type">
  <traits>
    <trait name="aid" value="EPM-DP-C1234" />
    <trait name="sid" value="EPM-1234" />
    <trait name="type" value="Integration Type" />
  </traits>
</test>
```

### Full configuration options

| Parameter      | Effect                                                                  |
| -------------- | ----------------------------------------------------------------------- |
| mochaFile      | configures the file to write reports to                                 |
| includePending | if set to a truthy value pending tests will be included in the report   |
| toConsole      | if set to a truthy value the produced XML will be logged to the console |
| assemblyName   | the name for the assembly element. (defaults to 'Mocha Tests')          |
| addTags        | if set to a truthy value will parse the test title for tags             |
