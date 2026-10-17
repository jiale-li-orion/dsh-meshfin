window.__ModuleLoader__.load({
  id: "@muwinds/dsh-archived-sessions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");

    // ---------- styles ----------
    var STYLE_ID = "dsw-arch-style";
    var CSS =
      ".dsw-arch-page{font-size:13px;padding:2px 2px 24px;}" +
      ".dsw-arch-toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px;}" +
      ".dsw-arch-page-title{font-weight:600;color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-meta{color:var(--dsw-alias-label-secondary);font-size:12px;}" +
      ".dsw-arch-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 7px;font-size:12px;cursor:pointer;margin-right:4px;white-space:nowrap;}" +
      ".dsw-arch-btn:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);}" +
      ".dsw-arch-btn:disabled{opacity:0.45;cursor:default;}" +
      ".dsw-arch-table{width:100%;border-collapse:collapse;table-layout:fixed;}" +
      ".dsw-arch-table th{text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);}" +
      ".dsw-arch-table td{padding:8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;}" +
      ".dsw-arch-table tr:last-child td{border-bottom:none;}" +
      ".dsw-arch-table th:nth-child(1),.dsw-arch-table td:nth-child(1){width:32px;text-align:center;padding-left:2px;padding-right:2px;}" +
      ".dsw-arch-table th:nth-child(2),.dsw-arch-table td:nth-child(2){width:auto;}" +
      ".dsw-arch-table th:nth-child(3),.dsw-arch-table td:nth-child(3){width:96px;}" +
      ".dsw-arch-actions{white-space:nowrap;}" +
      ".dsw-arch-title-click{cursor:pointer;color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-title-click:hover{text-decoration:underline;}" +
      ".dsw-arch-id{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary);word-break:break-all;margin-top:2px;}" +
      ".dsw-arch-selectbar{display:flex;align-items:center;gap:8px;padding:6px 10px;margin-bottom:10px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;font-size:12px;flex-wrap:wrap;}" +
      ".dsw-arch-selectbar .dsw-arch-meta{flex:1;}" +
      ".dsw-arch-detail{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;padding:10px 12px;font-size:12px;text-align:left;}" +
      ".dsw-arch-detail-head{margin-bottom:8px;}" +
      ".dsw-arch-detail-body{max-height:360px;overflow:auto;}" +
      ".dsw-arch-msg{margin-bottom:8px;white-space:pre-wrap;word-break:break-word;}" +
      ".dsw-arch-msg-role{display:inline-block;font-weight:600;margin-right:6px;}" +
      ".dsw-arch-msg-user .dsw-arch-msg-role{color:var(--dsw-alias-label-primary);}" +
      ".dsw-arch-msg-assistant .dsw-arch-msg-role{color:var(--dsw-alias-brand-primary);}" +
      ".dsw-arch-msg-tool .dsw-arch-msg-role{color:var(--dsw-alias-state-warn-primary);}" +
      ".dsw-arch-msg-time{color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:6px;}" +
      ".dsw-arch-detail-note{color:var(--dsw-alias-label-secondary);font-size:11px;margin-bottom:8px;}" +
      ".dsw-arch-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin-bottom:8px;}" +
      ".dsw-arch-empty{color:var(--dsw-alias-label-secondary);padding:28px 0;text-align:center;}" +
      ".dsw-arch-badge{display:inline-block;border:1px solid var(--dsw-alias-state-warn-primary);color:var(--dsw-alias-state-warn-primary);border-radius:4px;padding:1px 6px;font-size:11px;}";

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        var el = document.createElement("style");
        el.id = STYLE_ID;
        el.textContent = CSS;
        document.head.appendChild(el);
      } catch (error) {
        void error;
      }
    }

    function describe(error) {
      if (error === null || error === undefined) return String(error);
      if (typeof error === "object" && typeof error.message === "string") return error.message;
      return String(error);
    }

    /**
     * Preview one archived Session's stored log through the Host half.
     * The Host owns the read: the browser never sees a session artifact path.
     */
    function inspect(sessionId) {
      return fetch("/dsh-archived/inspect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId })
      }).then(function (res) {
        return res.json().catch(function () {
          return null;
        });
      }).then(function (payload) {
        if (payload === null || typeof payload !== "object") throw new Error("请求失败：服务返回了无效响应");
        if (payload.error) throw new Error(String(payload.error));
        return payload;
      });
    }

    function fmtSize(bytes) {
      var n = Number(bytes) || 0;
      if (n <= 0) return "0 B";
      var units = ["B", "KB", "MB", "GB", "TB"];
      var value = n;
      var unit = 0;
      while (value >= 1024 && unit < units.length - 1) {
        value = value / 1024;
        unit = unit + 1;
      }
      return (unit === 0 ? String(Math.round(value)) : value.toFixed(1)) + " " + units[unit];
    }

    function fmtTime(ms) {
      if (!ms) return "—";
      try {
        return new Date(ms).toLocaleString();
      } catch (error) {
        void error;
        return String(ms);
      }
    }

    /**
     * One stable observable over the archived Session rows.
     *
     * The rows combine two Client sources the page may not subscribe to itself:
     * the Workspace archive set (Host-authoritative) and the Session catalog
     * (titles, working directories, activity). `getSnapshot` keeps one object
     * identity until a value actually moves, as the renderer's hook binding
     * requires.
     */
    function createRowsSource(workspaces, sessions) {
      var snapshot = { ids: [], rows: [] };
      var signature = "";
      function read() {
        var archived = workspaces.list.getSnapshot().archivedSessionIds;
        var catalog = sessions.list.getSnapshot();
        var rows = [];
        for (var index = 0; index < archived.length; index++) {
          var id = archived[index];
          var summary = catalog.byId[id];
          var title = summary && (summary.title || summary.displayTitle);
          rows.push({
            id: id,
            title: title || null,
            cwd: (summary && summary.cwd) || null,
            updatedAt: (summary && summary.updatedAt) || 0,
            running: !!(summary && summary.running)
          });
        }
        rows.sort(function (a, b) {
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        return { ids: archived.slice(), rows: rows };
      }
      return {
        getSnapshot: function () {
          var next = read();
          var nextSignature = JSON.stringify(next);
          if (nextSignature !== signature) {
            signature = nextSignature;
            snapshot = next;
          }
          return snapshot;
        },
        subscribe: function (listener) {
          var offWorkspaces = workspaces.list.subscribe(listener);
          var offSessions = sessions.list.subscribe(listener);
          return function () {
            offWorkspaces();
            offSessions();
          };
        }
      };
    }

    // ---------- page component ----------
    function ArchivedSessionsPage(props) {
      var rows = props.useRows().rows;
      var unarchive = props.unarchive;

      var busyState = react.useState(null);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var errorState = react.useState(null);
      var error = errorState[0];
      var setError = errorState[1];
      var selectedState = react.useState([]);
      var selected = selectedState[0];
      var setSelected = selectedState[1];
      var batchState = react.useState(false);
      var batchBusy = batchState[0];
      var setBatchBusy = batchState[1];
      var expandedState = react.useState(null);
      var expandedId = expandedState[0];
      var setExpandedId = expandedState[1];
      var detailState = react.useState(null);
      var detail = detailState[0];
      var setDetail = detailState[1];

      var ids = rows.map(function (row) {
        return row.id;
      });
      var anyBusy = busy !== null || batchBusy;
      // A row that disappeared (restored elsewhere) leaves the selection with stale ids.
      var liveSelection = selected.filter(function (id) {
        return ids.indexOf(id) >= 0;
      });

      function restore(id) {
        setBusy(id);
        setError(null);
        return Promise.resolve(unarchive(id)).then(function () {
          setBusy(null);
        }).catch(function (failure) {
          setError(describe(failure));
          setBusy(null);
        });
      }

      function restoreAll(targets) {
        setBatchBusy(true);
        setError(null);
        var failures = [];
        var chain = Promise.resolve();
        targets.forEach(function (id) {
          chain = chain.then(function () {
            return Promise.resolve(unarchive(id)).catch(function (failure) {
              failures.push(id + ": " + describe(failure));
            });
          });
        });
        chain.then(function () {
          if (failures.length > 0) setError("释放失败 " + failures.length + " 个会话：" + failures.join("; "));
          setSelected([]);
          setBatchBusy(false);
        });
      }

      function toggleSelect(id) {
        setSelected(function (previous) {
          return previous.indexOf(id) >= 0
            ? previous.filter(function (entry) {
              return entry !== id;
            })
            : previous.concat([id]);
        });
      }

      function toggleSelectAll() {
        setSelected(function (previous) {
          return previous.length === ids.length ? [] : ids.slice();
        });
      }

      function toggleDetail(id) {
        if (expandedId === id) {
          setExpandedId(null);
          setDetail(null);
          return;
        }
        setExpandedId(id);
        setDetail({ id: id, loading: true, data: null, error: null });
        inspect(id).then(function (data) {
          setDetail({ id: id, loading: false, data: data, error: null });
        }).catch(function (failure) {
          setDetail({ id: id, loading: false, data: null, error: describe(failure) });
        });
      }

      function detailCell() {
        if (detail === null) return null;
        if (detail.loading) return react.createElement("div", { className: "dsw-arch-detail" }, "加载会话内容中…");
        if (detail.error) return react.createElement("div", { className: "dsw-arch-detail" }, String(detail.error));
        var data = detail.data;
        if (data === null || !Array.isArray(data.messages)) {
          return react.createElement("div", { className: "dsw-arch-detail" }, "没有可显示的内容");
        }
        var metaParts = [];
        if (data.createdAt) metaParts.push("创建于 " + fmtTime(data.createdAt));
        if (data.cwd) metaParts.push(data.cwd);
        if (typeof data.sizeBytes === "number") metaParts.push(fmtSize(data.sizeBytes));
        var head = react.createElement("div", { className: "dsw-arch-detail-head" },
          react.createElement("span", { className: "dsw-arch-page-title" }, "会话内容"),
          react.createElement("span", { className: "dsw-arch-meta" }, " · " + metaParts.join(" · ")));
        var note = react.createElement("div", { className: "dsw-arch-detail-note" },
          "共 " + String(data.eventCount) + " 条事件，提取 " + String(data.messageCount) + " 条消息" +
          (data.truncated ? "（仅显示最近 100 条）" : "") +
          (data.windowStart > 0 ? "（扫描自第 " + String(data.windowStart) + " 条）" : ""));
        var messages = data.messages.map(function (message) {
          var roleLabel = message.role === "user" ? "用户" : message.role === "assistant" ? "助手" : "工具";
          return react.createElement("div", { className: "dsw-arch-msg dsw-arch-msg-" + message.role },
            react.createElement("span", { className: "dsw-arch-msg-role" }, roleLabel),
            react.createElement("span", { className: "dsw-arch-msg-time" }, fmtTime(message.time)),
            react.createElement("div", null, message.text));
        });
        return react.createElement("div", { className: "dsw-arch-detail" }, head, note,
          react.createElement("div", { className: "dsw-arch-detail-body" }, messages));
      }

      var header = react.createElement("div", { className: "dsw-arch-toolbar" },
        react.createElement("span", { className: "dsw-arch-page-title" }, "归档会话"),
        react.createElement("span", { className: "dsw-arch-meta" },
          String(rows.length) + " 个会话" + (batchBusy ? " · 批量操作中…" : "")),
        react.createElement("button", {
          className: "dsw-arch-btn",
          disabled: anyBusy || rows.length === 0,
          onClick: function () {
            restoreAll(ids);
          }
        }, "一键释放"));

      var confirmBar = null;
      if (liveSelection.length > 0) {
        confirmBar = react.createElement("div", { className: "dsw-arch-selectbar" },
          react.createElement("span", { className: "dsw-arch-meta" }, "已选择 " + String(liveSelection.length) + " 个会话"),
          react.createElement("button", {
            className: "dsw-arch-btn",
            disabled: anyBusy,
            onClick: function () {
              restoreAll(liveSelection);
            }
          }, "释放选中"),
          react.createElement("button", {
            className: "dsw-arch-btn",
            disabled: anyBusy,
            onClick: function () {
              setSelected([]);
            }
          }, "取消选择"));
      }

      var body;
      if (rows.length === 0) {
        body = react.createElement("div", { className: "dsw-arch-empty" }, "没有已归档的会话");
      } else {
        var tableRows = [];
        rows.forEach(function (row) {
          var isBusy = busy === row.id;
          var confirming = expandedId === row.id;
          var metaParts = [];
          if (row.updatedAt) metaParts.push("最近更新 " + fmtTime(row.updatedAt));
          if (row.cwd) metaParts.push(row.cwd);
          tableRows.push(react.createElement("tr", { key: row.id },
            react.createElement("td", null, react.createElement("input", {
              type: "checkbox",
              checked: liveSelection.indexOf(row.id) >= 0,
              disabled: anyBusy,
              onChange: function () {
                toggleSelect(row.id);
              }
            })),
            react.createElement("td", null,
              react.createElement("div", {
                className: "dsw-arch-title-click",
                title: "点击查看会话内容",
                onClick: function () {
                  toggleDetail(row.id);
                }
              }, (confirming ? "▾ " : "▸ ") + (row.title || "(无标题)")),
              react.createElement("div", { className: "dsw-arch-id" }, row.id),
              react.createElement("div", { className: "dsw-arch-meta" }, metaParts.join(" · "))),
            react.createElement("td", null, row.running
              ? react.createElement("span", { className: "dsw-arch-badge" }, "运行中")
              : react.createElement("span", { className: "dsw-arch-meta" }, "已归档")),
            react.createElement("td", { className: "dsw-arch-actions" },
              react.createElement("button", {
                className: "dsw-arch-btn",
                disabled: anyBusy,
                onClick: function () {
                  restore(row.id);
                }
              }, isBusy ? "释放中…" : "释放"))));
          if (confirming) {
            tableRows.push(react.createElement("tr", { key: row.id + "-detail" },
              react.createElement("td", { colSpan: 4, style: { padding: "4px 10px 10px" } }, detailCell())));
          }
        });
        body = react.createElement("table", { className: "dsw-arch-table" },
          react.createElement("thead", null,
            react.createElement("tr", null,
              react.createElement("th", null, react.createElement("input", {
                type: "checkbox",
                checked: liveSelection.length === ids.length && ids.length > 0,
                disabled: anyBusy,
                onChange: function () {
                  toggleSelectAll();
                }
              })),
              react.createElement("th", null, "会话"),
              react.createElement("th", null, "状态"),
              react.createElement("th", null, "操作"))),
          react.createElement("tbody", null, tableRows));
      }

      var errorEl = error ? react.createElement("div", { className: "dsw-arch-error" }, String(error)) : null;
      return react.createElement("div", { className: "dsw-arch-page" }, errorEl, header, confirmBar, body);
    }

    // ---------- plugin body ----------
    var inject = ["slots", "workspaces", "sessions"];

    function apply(ctx) {
      ensureStyle();
      ctx.effect(function () {
        return function () {
          try {
            var el = document.getElementById(STYLE_ID);
            if (el) el.remove();
          } catch (error) {
            void error;
          }
        };
      }, "ui-archived-sessions: style cleanup");

      var rows = createRowsSource(ctx.workspaces, ctx.sessions);
      var injected = function () {
        return {
          hooks: { rows: rows },
          unarchive: function (sessionId) {
            return ctx.workspaces.unarchiveSession(sessionId);
          }
        };
      };

      ctx.slots.inject("settings.section", function () {
        return ctx.slots.register(
          { name: "settings.section", id: "archived-sessions", order: 30, label: function () { return "归档会话"; }, inject: injected },
          ArchivedSessionsPage
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
