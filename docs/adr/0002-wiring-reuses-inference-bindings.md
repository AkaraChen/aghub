# 接线复用 Inference 绑定,网关不做实例编排

每个网关实例同步为 `crates/inference` 库存中的一个供应商条目,agent 指向哪个实例由 Inference 现有的 per-agent 绑定决定;网关域不引入「使用中实例」或跨实例切换编排。理由:CLIProxyAPI 自身是单实例世界观(客户端各自配置指向,官方面板一次管一个实例),aghub 不发明上游没有的概念;同时绑定/回退(official_login)/active 推导全部免费复用,网关域代码面缩到进程与账号管理。
