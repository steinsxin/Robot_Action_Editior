# Robot_Action_Editior

一个纯 Python 启动的机器人 URDF Web 查看器。

## 启动

```bash
cd /home/ubuntu/Documents/robot-urdf-python-viewer
python3 server.py --host 127.0.0.1 --port 8765
```

然后在浏览器打开：

```text
http://127.0.0.1:8765
```

## 功能

- 扫描 `AutolifeRobotSDK/descriptions` 下的 URDF 文件
- 浏览器中显示机器人模型
- 自动生成关节滑条
- 支持拖拽机器人基座
- 支持基座 `x/y/z/yaw` 滑条控制

## 说明

- Python 端不依赖第三方库，使用标准库 `http.server`
- 浏览器端通过 CDN 加载 `three.js` 和 `urdf-loader`
- 如果网络不可用，CDN 资源将无法加载，需要改为本地 vendored 前端依赖