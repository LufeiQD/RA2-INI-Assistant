const fs = require('fs');
const path = require('path');

// 使用浏览器兼容的 DOM 模拟
const svgString = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), 'utf-8');

// 使用 sharp 库转换（更轻量）
const sharp = require('sharp');

sharp(Buffer.from(svgString))
  .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path.join(__dirname, '..', 'assets', 'icon.png'))
  .then(() => {
    console.log('SVG 已转换为 PNG');
  })
  .catch(err => {
    console.error('转换失败:', err);
  });
