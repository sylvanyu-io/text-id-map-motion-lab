# Text ID Map Motion Lab

一个不依赖框架的 WebGL 2 原型，用一张打包纹理在单个文本 Quad 上实现逐字动画与调试。

## 渲染方式

- `R` 通道保存 Canvas 2D 排版生成的字形 Alpha。
- `G` 通道保存每个字符排版单元的唯一 ID。
- Bounds LUT 保存字符中心、字符域和字形尺寸。
- Fragment Shader 通过字符 ID 驱动独立 pivot、运动相位、碎片轨迹、色差和颜色脉冲。
- 每个双线性采样 tap 都会核对字符 ID，避免相邻字形在变形时互相污染。

页面提供一套 5.6 秒综合演出：逐字飞入、Glitch 切片显现、阻尼回摆、橙青错相、沙粒化消散、轨迹汇聚与停留。

## 目录

- `index.html`：Motion Lab 页面与控制面板。
- `app.js`：文字纹理生成、WebGL 2 渲染与时间轴逻辑。
- `styles.css`：页面样式。
- `cover.png`：项目封面。

## 运行

```bash
cd text-id-map-motion-lab
python3 -m http.server 4174
```

浏览器打开 `http://127.0.0.1:4174/`。
