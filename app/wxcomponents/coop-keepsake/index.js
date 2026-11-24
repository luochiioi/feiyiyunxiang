const { paint } = require('./paint')

Component({
  properties: { pattern: String, palette: String },
  data: { busy: false, path: '', message: '' },
  methods: {
    generate() {
      if (this.data.busy || this.data.path) return
      const failed = () => this.setData({ busy: false, message: '生成失败，请重试。' })
      this.setData({ busy: true, message: '' }, () => {
        this.createSelectorQuery().select('#art').fields({ node: true }).exec(([result]) => {
          const canvas = result?.node
          if (!canvas) return failed()
          canvas.width = 720
          canvas.height = 760
          try { paint(canvas.getContext('2d'), this.data.pattern, this.data.palette) }
          catch (_) { return failed() }
          wx.canvasToTempFilePath({
            canvas, fileType: 'png',
            success: ({ tempFilePath }) => this.setData({ busy: false, path: tempFilePath }),
            fail: failed
          }, this)
        })
      })
    },
    preview() {
      if (this.data.path) wx.previewImage({ urls: [this.data.path] })
    },
    save() {
      if (!this.data.path) return
      wx.saveImageToPhotosAlbum({ filePath: this.data.path,
        success: () => wx.showToast({ title: '已保存', icon: 'success' }),
        fail: error => {
          if (!/auth deny|auth denied|authorize no response/i.test(error.errMsg)) {
            this.setData({ message: '未能保存图片，请检查微信的相册权限后重试。' })
            return
          }
          wx.showModal({ title: '允许保存到相册', content: '请在设置中打开相册写入权限，再点保存。',
            success: result => { if (result.confirm) wx.openSetting() } })
        }
      })
    },
    share() {
      if (!this.data.path) return
      if (typeof wx.showShareImageMenu === 'function') {
        wx.showShareImageMenu({ path: this.data.path, needShowEntrance: false, fail: error => {
          if (!error.errMsg.toLowerCase().includes('cancel')) this.preview()
        } })
      } else this.preview()
    },
    compose() {
      if (!this.data.path) return
      wx.navigateTo({ url: '/packages/community/community-compose/community-compose?keepsake=' + encodeURIComponent(this.data.path),
        fail: () => this.setData({ message: '暂时打不开发布页，请重试。' }) })
    }
  }
})
