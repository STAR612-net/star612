module.exports = {
    // ... 기존 설정 ...
    devtool: 'eval-source-map',
    module: {
      rules: [
        {
          test: /\.js$/,
          enforce: 'pre',
          use: ['source-map-loader'],
        },
      ],
    },
    ignoreWarnings: [/Failed to parse source map/],
  };