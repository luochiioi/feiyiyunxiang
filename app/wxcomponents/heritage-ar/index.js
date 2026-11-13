const MODEL_URL = '' // Set to the original Aomiao GLB when it is available.

Component({
  data: { modelUrl: MODEL_URL, ready: false, useAr: false, width: 0, height: 0, renderWidth: 0, renderHeight: 0 },
  lifetimes: {
    attached() {
      if (!MODEL_URL) return
      const device = wx.getDeviceInfo()
      const window = wx.getWindowInfo()
      const width = window.windowWidth - 32
      const height = Math.floor(window.windowHeight * 0.67)
      const pixelRatio = Math.min(window.pixelRatio, 2)
      this.setData({
        ready: typeof wx.getXrFrameSystem === 'function',
        useAr: device.platform === 'ios' || device.platform === 'android',
        width, height,
        renderWidth: Math.floor(width * pixelRatio),
        renderHeight: Math.floor(height * pixelRatio)
      })
    }
  }
})
