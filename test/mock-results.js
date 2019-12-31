const xml = require('xml')

module.exports = function(stats) {
  const data = {
    assemblies: [
      {
        assembly: [
          {
            _attr: {
              name: 'Mocha Tests',
              total: '3',
              passed: '1',
              failed: '2',
              skipped: '0',
              time: '0.003',
              'run-date': stats.start.toISOString().split('T')[0],
              'run-time': stats.start
                .toISOString()
                .split('T')[1]
                .split('.')[0],
            },
          },
          {
            collection: [
              {
                _attr: {
                  name: 'Foo Bar module',
                  total: '3',
                  passed: '1',
                  failed: '2',
                  skipped: '0',
                  time: '0.003',
                },
              },
              {
                test: [
                  {
                    _attr: {
                      name: 'can weez the juice',
                      time: '0.001',
                      result: 'Pass',
                    },
                  },
                ],
              },
              {
                test: [
                  {
                    _attr: {
                      name: 'can narfle the garthog',
                      time: '0.001',
                      result: 'Fail',
                    },
                  },
                ],
              },
              {
                test: [
                  {
                    _attr: {
                      name: 'can behave like a flandip',
                      time: '0.001',
                      result: 'Fail',
                    },
                  },
                ],
              },
            ],
          },
          {
            collection: [
              {
                _attr: {
                  name: '@test=A Another suite!',
                  total: '2',
                  passed: '2',
                  failed: '0',
                  skipped: '0',
                  time: '0.008',
                },
              },
              {
                test: [
                  {
                    _attr: {
                      name: 'works',
                      time: '0.004',
                      result: 'Pass',
                    },
                  },
                  {
                    traits: [
                      {
                        trait: [
                          {
                            _attr: {
                              name: 'test',
                              value: 'A',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              {
                test: [
                  {
                    _attr: {
                      name: 'works',
                      time: '0.004',
                      result: 'Pass',
                    },
                  },
                  {
                    traits: [
                      {
                        trait: [
                          {
                            _attr: {
                              name: 'test',
                              value: 'A',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            ...(stats.pending
              ? {
                  collection: [
                    {
                      _attr: {
                        name: 'Pending suite!',
                        total: '1',
                        passed: '0',
                        failed: '0',
                        skipped: '1',
                        time: '0',
                      },
                    },
                    {
                      test: [
                        {
                          _attr: {
                            name: 'pending',
                            time: '0',
                            result: 'Skip',
                          },
                        },
                      ],
                    },
                  ],
                }
              : {}),
          },
        ],
      },
    ],
  }

  return xml(data, { declaration: true })
}
