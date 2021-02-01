# cypress-xray-reporter

A Cypress XRay reporter. Produces XUnit-style XML test results, when used with `xrayReport` will make the report
suitable for XRay upload. Adapted from and Inspired by
[mocha-xunit-reporter](https://github.com/passuied/mocha-xunit-reporter)

## Installation

```bash
$ yarn add -D https://git@github.com/Superformula/cypress-xray-reporter.git#2.0.2
```

## Usage

Run mocha with `cypress-xray-reporter`:

```bash
$ mocha test --reporter cypress-xray-reporter
```

This will output a results file at `./test-results.xml`.

You may optionally declare an alternate location for the resulting XML file by setting the environment variable
`MOCHA_FILE` or specifying `mochaFile` in `reporterOptions`:

```bash
$ MOCHA_FILE=./path_to_your/file.xml mocha test --reporter cypress-xray-reporter
```

or

```bash
$ mocha test --reporter cypress-xray-reporter --reporter-options mochaFile=./path_to_your/file.xml
```

or

```javascript
var mocha = new Mocha({
  reporter: 'cypress-xray-reporter',
  reporterOptions: {
    mochaFile: './path_to_your/file.xml',
  },
})
```

### `addTags` option

- If set to true, will parse the test title for tags in format `@tagName=tagValue` and will add them as attributes of
  the test XML element AND as their own `<trait>` elements. It will also clean the outputted tags from the test name XML
  attribute.
- See example below:

```javascript
var mocha = new Mocha({
  reporter: 'cypress-xray-reporter',
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
| xrayReport     | if truthy, will make the report compatible with XRay                    |
| includePending | if set to a truthy value pending tests will be included in the report   |
| toConsole      | if set to a truthy value the produced XML will be logged to the console |
| assemblyName   | the name for the assembly element. (defaults to 'Mocha Tests')          |
| addTags        | if set to a truthy value will parse the test title for tags             |
