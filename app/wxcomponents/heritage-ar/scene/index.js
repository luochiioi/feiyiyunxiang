Component({
  properties: { useAr: Boolean, modelUrl: String },
  methods: {
    handleReady({ detail }) { this.scene = detail.value },
    handleTouchStart(event) { this.startX = event.touches[0]?.clientX },
    handleTouchMove(event) {
      const currentX = event.touches[0]?.clientX
      if (currentX == null || this.startX == null || this.scene == null) return
      const transform = this.scene.getNodeById('setitem')?.getComponent('transform')
      if (transform != null) transform.rotation.y += (currentX - this.startX) * 0.02
      this.startX = currentX
    }
  }
})
