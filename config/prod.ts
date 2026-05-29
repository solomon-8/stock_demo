import type { UserConfigExport } from '@tarojs/cli'

export default {
  mini: {},
  h5: {
    // GitHub Pages 项目站点部署在 /stock_demo/ 子路径下，
    // 故生产构建静态资源 publicPath 指向该子路径（开发构建仍用 '/')。
    publicPath: '/stock_demo/',
    /**
     * 如需打开 H5 包体分析，可设置 enable: true
     */
    // webpackChain (chain) {
    //   chain.plugin('analyzer')
    //     .use(require('webpack-bundle-analyzer').BundleAnalyzerPlugin, [])
    // },
  },
} satisfies UserConfigExport<'webpack5'>
