# 青澜市城市内涝 GIS 侦测工作台

基于 React + TypeScript + Vite + OpenLayers + Turf.js 的交互式城市内涝 GIS 系统。
所有空间数据（地形、降雨、水系、道路、建筑、低洼区、积水深度、内涝风险）均为**程序化生成的虚拟城市数据**，内涝模型为简化水文模型，非水动力模型，不可用于真实灾害预测。

## 在线访问

https://yetianshuo123.github.io/qinglan-flood-gis/

## 本地运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物输出到 dist/
npm run preview
```

## 部署方式

站点以 `gh-pages` 分支发布（纯静态，无需服务器）：

```bash
# 更新线上版本
VITE_BASE=/qinglan-flood-gis/ npm run build
git subtree push --prefix dist origin gh-pages
```

`VITE_BASE` 用于适配 GitHub Pages 的子路径 `/qinglan-flood-gis/`；本地与根路径托管时不必设置。

## 更新与回滚

- 改源码后提交到 `main`，重新构建推送 `gh-pages` 即可生效，网址不变
- GitHub 仓库的 **Actions → Deployments** 或 **Environments → github-pages** 中可查看历史部署并回滚

## 论文引用（DOI）

仓库发布 Release 后，在 <https://zenodo.org> 用 GitHub 登录并开启该仓库归档，Zenodo 会为每个 Release 生成 DOI：

```text
作者. (2026). 青澜市城市内涝 GIS 侦测工作台 (Version 1.0.0) [Computer software].
Zenodo. https://doi.org/10.5281/zenodo.XXXXXXX
```

论文中建议同时给出在线访问链接、Zenodo DOI，以及“虚拟城市数据 + 简化模型，不可用于真实灾害预测”的说明。
