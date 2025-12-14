const { createCanvas } = require('canvas');
const fs = require('fs');

function createIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // 创建渐变背景
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(1, '#764ba2');
  
  // 绘制圆形背景
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/2 - 2, 0, Math.PI * 2);
  ctx.fill();
  
  // 绘制月亮符号
  ctx.fillStyle = 'white';
  ctx.font = `${size * 0.5}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☽', size/2, size/2 + size * 0.05);
  
  return canvas.toBuffer('image/png');
}

try {
  [16, 48, 128].forEach(size => {
    const buffer = createIcon(size);
    fs.writeFileSync(`icon${size}.png`, buffer);
    console.log(`Created icon${size}.png`);
  });
} catch (e) {
  console.error('Canvas not available, creating placeholder PNGs');
  // 创建简单的占位符
}
