import type { UserConfigExport } from '@tarojs/cli'

export default {
  mini: {},
  h5: {
    /**
     * 如需打开 H5 包体分析，可设置 enable: true
     */
    // webpackChain (chain) {
    //   chain.plugin('analyzer')
    //     .use(require('webpack-bundle-analyzer').BundleAnalyzerPlugin, [])
    // },
  },
} satisfies UserConfigExport<'webpack5'>
