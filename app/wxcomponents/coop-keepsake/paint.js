const colors = { mist: '#527ea8', cobalt: '#265ba0', indigo: '#2f5282' }

function label(ctx, text, x, y, size, color) {
  ctx.font = size + "px sans-serif"
  ctx.fillStyle = color
  ctx.textAlign = "center"
  ctx.fillText(text, x, y)
}

function tile(ctx, pattern, color) {
  ctx.save()
  ctx.translate(206, 388)
  ctx.strokeStyle = color
  ctx.lineWidth = 6
  ctx.strokeRect(-105, -105, 210, 210)
  ctx.lineWidth = 3
  ctx.strokeRect(-92, -92, 184, 184)
  if (pattern === "sail") {
    ctx.beginPath()
    ctx.moveTo(0, -67)
    ctx.quadraticCurveTo(-15, -27, -65, 20)
    ctx.lineTo(0, 20)
    ctx.closePath()
    ctx.moveTo(13, -49)
    ctx.quadraticCurveTo(35, -10, 63, 20)
    ctx.lineTo(13, 20)
    ctx.closePath()
    ctx.moveTo(-62, 39)
    ctx.quadraticCurveTo(10, 86, 65, 39)
    ctx.stroke()
  } else {
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4)
      ctx.beginPath()
      ctx.moveTo(0, 0)
      if (pattern === "rose") {
        ctx.bezierCurveTo(-31, -31, -16, -71, 0, -72)
        ctx.bezierCurveTo(17, -71, 31, -31, 0, 0)
      } else {
        ctx.lineTo(-17, -49)
        ctx.lineTo(0, -78)
        ctx.lineTo(17, -49)
        ctx.closePath()
      }
      ctx.stroke()
    }
  }
  ctx.restore()
}

function embroidery(ctx) {
  ctx.save()
  ctx.translate(514, 388)
  ctx.lineWidth = 3
  ctx.lineCap = "round"
  ctx.strokeStyle = "#a8755f"
  ctx.strokeRect(-105, -105, 210, 210)
  ctx.strokeRect(-92, -92, 184, 184)
  for (let i = 0; i < 54; i++) {
    const angle = 2 * Math.PI * i / 54
    const petal = 63 + 15 * Math.cos(6 * angle)
    ctx.strokeStyle = ["#a23f4d", "#bb616f", "#bd785a"][i % 3]
    ctx.beginPath()
    ctx.moveTo(16 * Math.cos(angle), 16 * Math.sin(angle))
    ctx.quadraticCurveTo(52 * Math.cos(angle - 0.16), 52 * Math.sin(angle - 0.16),
      petal * Math.cos(angle), petal * Math.sin(angle))
    ctx.stroke()
  }
  ctx.restore()
}

function paint(ctx, pattern, palette) {
  ctx.fillStyle = "#fcf3df"
  ctx.fillRect(0, 0, 720, 760)
  ctx.strokeStyle = "#a06a43"
  ctx.lineWidth = 2
  ctx.strokeRect(28, 28, 664, 704)
  ctx.fillStyle = "#f3e2cd"
  ctx.fillRect(60, 216, 600, 350)
  ctx.fillStyle = "#fffaf0"
  ctx.fillRect(74, 230, 264, 322)
  ctx.fillRect(382, 230, 264, 322)
  label(ctx, "湘澳合作纪念", 360, 108, 23, "#704e3c")
  label(ctx, "海丝瓷绣 · 一念归期", 360, 166, 42, "#2f3d38")
  label(ctx, "澳门 · 瓷砖纹样", 206, 268, 22, "#274661")
  label(ctx, "湖南 · 湘绣针线", 514, 268, 22, "#773d43")
  tile(ctx, pattern, colors[palette] ?? colors.indigo)
  embroidery(ctx)
  label(ctx, "两地旅伴 · 共读终章", 360, 631, 28, "#3f4e43")
  label(ctx, "非遗云享", 360, 687, 22, "#704e3c")
}

module.exports = { paint }
