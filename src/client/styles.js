    // ---------------------------------------------------------------- css

    const CSS = `
.qp-island-anchor,.qp-panel-anchor{position:fixed;transform:translateX(-50%);z-index:60;pointer-events:none}
.qp-island{pointer-events:auto;-webkit-app-region:no-drag;display:flex;align-items:center;gap:9px;height:40px;max-width:min(520px,62vw);padding:0 13px 0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1,#2c3340);background:var(--dsw-alias-bg-layer-1,#1b1f27);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12px;line-height:1;cursor:grab;box-shadow:0 10px 30px rgb(0 0 0 / .18),0 1px 2px rgb(0 0 0 / .12);touch-action:none;user-select:none;animation:qp-pop .18s cubic-bezier(.22,1,.36,1);transition:background .18s ease,box-shadow .18s ease}
.qp-island:active{cursor:grabbing}
.qp-island:hover{background:var(--dsw-alias-bg-layer-2,#22262e)}
@keyframes qp-pop{from{opacity:0;transform:translateY(-4px) scale(.96)}to{opacity:1;transform:none}}
.qp-dot{width:8px;height:8px;border-radius:50%;border:1.5px solid var(--dsw-alias-state-idle-primary,#6b7483);flex:none;box-sizing:border-box}
.qp-dot.is-live{border-color:transparent;background:var(--dsw-alias-state-success-primary,#3ddc97);box-shadow:0 0 0 4px rgb(61 220 151 / .16);animation:qp-breathe 1.8s ease-in-out infinite}
@keyframes qp-breathe{0%,100%{box-shadow:0 0 0 3px rgb(61 220 151 / .14)}50%{box-shadow:0 0 0 7px rgb(61 220 151 / .05)}}
.qp-island-brand{font-weight:600;white-space:nowrap}
.qp-island-sep{width:1px;height:12px;background:var(--dsw-alias-border-l1,#2c3340);flex:none}
.qp-island-text{color:var(--dsw-alias-label-secondary,#98a2b3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;min-width:0}
.qp-island-time{color:var(--dsw-alias-label-secondary,#98a2b3);font-variant-numeric:tabular-nums;margin-left:2px}
.qp-panel{pointer-events:auto;position:relative;display:flex;flex-direction:column;border-radius:18px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);box-shadow:0 24px 64px rgb(0 0 0 / .22),0 2px 8px rgb(0 0 0 / .1);overflow:hidden;font-size:13px;outline:none;transform-origin:top center;animation:qp-drop .26s cubic-bezier(.22,1,.36,1)}
@keyframes qp-drop{from{opacity:0;transform:translateY(-8px) scale(.97)}to{opacity:1;transform:none}}
.qp-head{padding:12px 16px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,#2b3039);background:linear-gradient(180deg,var(--dsw-alias-bg-layer-2,#21252d) 0%,transparent 100%);cursor:grab;touch-action:none;user-select:none}
.qp-head:active{cursor:grabbing}
.qp-head-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.qp-title{display:flex;align-items:center;gap:7px;font-size:11px;letter-spacing:.06em;color:var(--dsw-alias-label-secondary,#98a2b3);font-weight:600}
.qp-grip{display:inline-flex;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.55;margin-right:1px}
.qp-badge{font-size:9px;padding:2px 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#22262e);border:1px solid var(--dsw-alias-border-l1,#2b3039);color:var(--dsw-alias-label-secondary,#98a2b3);font-weight:600;letter-spacing:.04em}
.qp-head-actions{display:flex;gap:2px;cursor:default}
.qp-iconbtn{width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);cursor:pointer}
.qp-iconbtn:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-clock{display:flex;align-items:baseline;gap:1px;font-size:30px;font-weight:600;letter-spacing:-.01em;line-height:1.1;margin-top:8px;font-variant-numeric:tabular-nums}
.qp-clock-sec{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#98a2b3);margin-left:2px}
.qp-date{margin-top:4px;font-size:11px;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-head-status{display:flex;align-items:center;gap:6px;margin-top:6px;font-size:10.5px;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-capture-wrap{padding:10px 16px 8px;border-bottom:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-base,#15181d)}
.qp-section{margin-top:14px}
.qp-section-title{font-size:10.5px;font-weight:600;letter-spacing:.08em;color:var(--dsw-alias-label-secondary,#98a2b3);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between}
.qp-count{font-size:10px;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.75;font-variant-numeric:tabular-nums}
.qp-capture{display:flex;align-items:flex-end;gap:6px}
.qp-capture-input{flex:1;min-width:0;min-height:34px;max-height:86px;resize:none;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:9px;background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12px;line-height:1.45;padding:7px 10px;outline:none;box-sizing:border-box}
.qp-capture-input::placeholder{color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.7}
.qp-capture-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.qp-add{width:34px;height:34px;flex:none;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:9px;background:#e7cd8b !important;color:#2a2313 !important;cursor:pointer}
.qp-add:disabled{opacity:.35;cursor:default}
.qp-add:hover:not(:disabled){filter:brightness(1.06)}
.qp-hint{margin-top:6px;font-size:10.5px;line-height:1.4;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.8}
.qp-body{flex:1;min-height:0;overflow:auto;padding:2px 16px 12px}
.qp-todo{display:flex;align-items:center;gap:8px;min-height:38px;padding:5px 0;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#2b3039) 55%,transparent)}
.qp-todo:last-child{border-bottom:0}
.qp-todo-index{flex:none;width:16px;text-align:right;color:var(--dsw-alias-label-tertiary,#6f7a8c);font-size:10.5px;font-variant-numeric:tabular-nums}
.qp-todo-check{width:18px;height:18px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;border:1.5px solid var(--dsw-alias-border-l2,#3a4150);background:transparent;color:#fff;cursor:pointer;padding:0}
.qp-todo-check.is-on{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:transparent}
.qp-todo-main{flex:1;min-width:0;display:flex;align-items:center;gap:6px;cursor:text}
.qp-todo-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;line-height:1.5}
.qp-todo.is-done .qp-todo-text{text-decoration:line-through;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-todo.is-done{opacity:.72}
.qp-tag{flex:none;font-size:9px;padding:1px 5px;border-radius:4px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 16%,transparent);color:var(--dsw-alias-brand-primary,#4d6bfe);font-weight:600}
.qp-todo-actions{display:flex;align-items:center;gap:1px;opacity:0;transition:opacity .15s ease}
.qp-todo:hover .qp-todo-actions,.qp-todo:focus-within .qp-todo-actions{opacity:1}
.qp-mini{width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);cursor:pointer;padding:0}
.qp-mini:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-done-dot{width:19px;height:19px;flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2,#3a4150);background:transparent;color:#08130f;cursor:pointer;padding:0}
.qp-done-dot.is-on{background:var(--dsw-alias-state-success-primary,#3ddc97);border-color:transparent}
.qp-edit-input{flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-brand-primary,#4d6bfe);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12.5px;padding:0 8px;outline:none}
.qp-empty{padding:18px 4px;color:var(--dsw-alias-label-secondary,#98a2b3);font-size:11.5px;line-height:1.6;text-align:center}
.qp-empty-title{color:var(--dsw-alias-label-primary,#e9ecf1);font-size:12.5px;font-weight:600;margin-bottom:4px}
.qp-placeholder{font-size:11.5px;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.8;line-height:1.5;padding:2px 0}
.qp-foot{padding:10px 16px 12px;border-top:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-2,#20242b)}
.qp-input{height:38px;display:flex;align-items:center;padding:0 12px;border-radius:10px;border:1px dashed var(--dsw-alias-border-l2,#3a4150);color:var(--dsw-alias-label-secondary,#98a2b3);font-size:12px;background:var(--dsw-alias-bg-layer-1,#1a1d24);cursor:not-allowed;opacity:.8}
.qp-foot-meta{display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10px;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.75}
.qp-flash{position:absolute;left:16px;right:16px;bottom:96px;z-index:5;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-overlay,#262b35);color:var(--dsw-alias-label-primary,#e9ecf1);font-size:11.5px;line-height:1.4;box-shadow:0 8px 24px rgb(0 0 0 / .22);animation:qp-fade .16s ease}
@keyframes qp-fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.qp-section-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);cursor:pointer;padding:0}
.qp-section-action:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-reminder-list{display:flex;flex-direction:column}
.qp-reminder{display:flex;align-items:center;gap:8px;min-height:32px;padding:3px 0;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#2b3039) 55%,transparent);font-size:12px}
.qp-reminder:last-child{border-bottom:0}
.qp-reminder.is-past{opacity:.65}
.qp-reminder.is-due{color:var(--dsw-alias-state-warn-primary,#f5b544)}
.qp-reminder-index{flex:none;width:16px;text-align:right;color:var(--dsw-alias-label-tertiary,#6f7a8c);font-size:10.5px;font-variant-numeric:tabular-nums}
.qp-reminder-time{flex:none;min-width:64px;font-size:10.5px;color:var(--dsw-alias-label-secondary,#98a2b3);font-variant-numeric:tabular-nums}
.qp-reminder-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qp-reminder-form{margin:6px 0 8px;padding:10px;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#22262e);display:flex;flex-direction:column;gap:8px}
.qp-form-input{height:30px;min-width:0;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12px;padding:0 8px;outline:none}
.qp-form-input:focus{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.qp-form-row{display:flex;gap:8px;align-items:center}
.qp-form-row .qp-form-input{flex:1}
.qp-form-select{height:30px;flex:none;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:7px;background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12px;padding:0 6px;outline:none}
.qp-form-error{font-size:10.5px;color:var(--dsw-alias-state-error-primary,#ff6b6b)}
.qp-btn{height:30px;min-width:56px;padding:0 12px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:11.5px;cursor:pointer}
.qp-btn:hover{background:var(--dsw-alias-bg-layer-2,#22262e)}
.qp-btn.is-primary{background:#e7cd8b !important;border-color:transparent !important;color:#2a2313 !important}
.qp-btn:disabled{opacity:.45;cursor:default}
.qp-due-card{pointer-events:auto;width:340px;max-width:min(86vw,380px);padding:12px 14px 10px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);box-shadow:0 20px 50px rgb(0 0 0 / .26),0 2px 8px rgb(0 0 0 / .1);animation:qp-drop .22s cubic-bezier(.22,1,.36,1);cursor:pointer}
.qp-due-head{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:600;color:var(--dsw-alias-state-warn-primary,#f5b544)}
.qp-due-text{margin-top:5px;font-size:12.5px;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.qp-due-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}
.qp-due-actions button{height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:11px;cursor:pointer}
.qp-due-actions button.is-primary{background:#e7cd8b !important;border-color:transparent !important;color:#2a2313 !important}
.qp-due-banner{display:flex;align-items:center;gap:7px;margin:10px 16px 0;padding:7px 9px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5b544) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5b544) 10%,transparent);color:var(--dsw-alias-label-primary,#e9ecf1);font-size:11px}
.qp-due-banner-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.qp-due-banner-btn{height:24px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-1,#1a1d24);color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:10.5px;cursor:pointer;flex:none}
.qp-due-banner-btn.is-primary{background:#e7cd8b !important;border-color:transparent !important;color:#2a2313 !important}
.qp-panel ::selection{background:rgb(246 227 161 / .32);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-capture-input,.qp-edit-input,.qp-form-input,.qp-form-select{caret-color:#e3c76d}
.qp-capture-input:focus,.qp-capture-input:focus-visible,.qp-edit-input:focus,.qp-form-input:focus,.qp-form-select:focus{outline:none !important;border-color:#d9b85e !important;box-shadow:0 0 0 3px rgb(246 227 161 / .18)}
.qp-capture-input:focus,.qp-edit-input:focus{background-color:var(--dsw-alias-bg-layer-2,#22262e) !important}
.qp-form-input:focus,.qp-form-select:focus{background-color:var(--dsw-alias-bg-layer-1,#1a1d24) !important}
.qp-date-input{width:100%;flex:none;min-width:0}
.qp-clockpick{width:100%;box-sizing:border-box;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:8px 10px;border-radius:12px;border:1px solid var(--dsw-alias-border-l1,#2b3039);background:var(--dsw-alias-bg-layer-1,#1a1d24);perspective:320px}
.qp-wheel{display:flex;flex-direction:column;align-items:center;width:100%;border-radius:8px;outline:none;user-select:none;touch-action:none;cursor:ns-resize}
.qp-wheel:focus-visible{box-shadow:0 0 0 2px rgb(246 227 161 / .4)}
.qp-wheel-step{border:0;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);font:inherit;font-size:12px;line-height:1.5;padding:0;cursor:pointer;opacity:.5;font-variant-numeric:tabular-nums}
.qp-wheel-step:hover{opacity:.95;color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-wheel-current{font-size:32px;font-weight:600;line-height:1.15;color:var(--dsw-alias-label-primary,#e9ecf1);font-variant-numeric:tabular-nums;transform-origin:center;animation:qp-flip .22s ease}
.qp-clockpick-colon{font-size:22px;color:var(--dsw-alias-label-secondary,#98a2b3);padding:0 6px}
@keyframes qp-flip{from{opacity:.15;transform:rotateX(-65deg)}to{opacity:1;transform:rotateX(0)}}
.qp-form-label{flex:none;width:36px;font-size:11px;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-checkline{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px;color:var(--dsw-alias-label-secondary,#98a2b3);line-height:1.4;cursor:pointer;user-select:none}
.qp-checkline-box{width:14px;height:14px;margin:0;flex:none;accent-color:#e7cd8b;cursor:pointer}
.qp-checkline-hint{font-size:10px;opacity:.7}
.qp-tag.is-link{cursor:pointer;border:0;font:inherit;font-size:9px;font-weight:600;padding:1px 5px;line-height:1.4}
.qp-link-btn{display:inline-flex;align-items:center;gap:4px;margin-top:6px;padding:4px 0;border:0;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:10.5px;cursor:pointer;text-align:left}
.qp-link-btn:hover{text-decoration:underline}
.qp-feed-section{margin-top:14px;position:relative}
.qp-feed{height:240px;overflow-y:auto;overscroll-behavior:contain;overflow-anchor:none;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1a1d24);padding:6px 10px 14px;scrollbar-width:thin}
.qp-feed-more{font-size:9.5px;color:var(--dsw-alias-label-secondary,#98a2b3);text-align:center;padding:2px 0 6px;opacity:.7}
.qp-feed-note{font-size:10.5px;color:var(--dsw-alias-label-secondary,#98a2b3);padding:10px 0;text-align:center}
.qp-feed-row{padding:6px 0;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#2b3039) 50%,transparent);font-size:11.5px;line-height:1.55;content-visibility:auto;contain-intrinsic-size:auto 52px}
.qp-feed-row:last-child{border-bottom:0}
.qp-feed-row.is-user{border-left:2px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 55%,transparent);padding-left:8px;margin-left:-2px}
.qp-feed-row.is-steering{border-left:2px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5b544) 55%,transparent);padding-left:8px;margin-left:-2px}
.qp-feed-meta{font-size:9px;font-weight:600;color:var(--dsw-alias-label-secondary,#98a2b3);margin-bottom:2px;letter-spacing:.02em}
.qp-feed-body,.qp-feed-text{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-feed-image-tag{display:inline-block;margin-bottom:3px;padding:1px 6px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 32%,transparent);border-radius:5px;color:var(--dsw-alias-label-secondary,#98a2b3);font-size:9px;line-height:1.5}
.qp-feed-images{display:flex;flex-wrap:wrap;gap:5px;margin:4px 0}
.qp-feed-image{width:104px;height:76px;object-fit:cover;border-radius:7px;border:1px solid color-mix(in srgb,var(--dsw-alias-border-l1,#2b3039) 80%,transparent);background:var(--dsw-alias-bg-layer-2,#22262e);display:block}
.qp-feed-text>span{white-space:pre-wrap}
.qp-reasoning{margin:4px 0;padding:5px 8px;border-left:2px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5b544) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f5b544) 7%,transparent);border-radius:0 7px 7px 0}
.qp-reasoning-label{font-size:8.5px;font-weight:600;color:var(--dsw-alias-label-secondary,#98a2b3);margin-bottom:2px}
.qp-reasoning-text{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-secondary,#98a2b3);max-height:110px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.qp-tool-chip{display:inline-flex;align-items:center;gap:5px;margin:3px 4px 3px 0;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:6px;background:var(--dsw-alias-bg-layer-2,#22262e);font-size:9.5px;color:var(--dsw-alias-label-secondary,#98a2b3);max-width:100%}
.qp-tool-chip.is-result{display:flex;margin:4px 0;width:fit-content}
.qp-tool-chip.is-error{color:var(--dsw-alias-state-error-primary,#ff6b6b);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ff6b6b) 35%,transparent)}
.qp-tool-dot{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);flex:none}
.qp-tool-chip.is-error .qp-tool-dot{background:var(--dsw-alias-state-error-primary,#ff6b6b)}
.qp-code{margin:5px 0;border:1px solid #2a303b;border-radius:8px;background:#12151b;overflow:hidden}
.qp-code-head{padding:3px 8px;border-bottom:1px solid #232935;font-size:8.5px;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-code pre{margin:0;padding:6px 8px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10px;line-height:1.5;color:#c9d1d9;white-space:pre;overflow:auto;max-height:220px}
.qp-caret{display:inline-block;width:5px;height:11px;margin-left:2px;background:var(--dsw-alias-brand-primary,#4d6bfe);vertical-align:-1px;animation:qp-blink 1s steps(2) infinite}
@keyframes qp-blink{50%{opacity:0}}
.qp-feed-status{display:flex;align-items:center;gap:6px;padding:6px 0;font-size:10px;color:var(--dsw-alias-label-secondary,#98a2b3)}
.qp-feed-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);animation:qp-breathe 1.6s ease-in-out infinite}
.qp-feed-row.is-error .qp-feed-error{color:var(--dsw-alias-state-error-primary,#ff6b6b);font-size:10.5px}
.qp-quick-wrap{display:flex;flex-direction:column;gap:4px}
.qp-window-row{width:100%;height:30px;margin-bottom:8px;display:flex;align-items:center;justify-content:center;gap:6px;border:1px dashed color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 42%,var(--dsw-alias-border-l1,#2b3039));border-radius:8px;background:transparent;color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:10.5px;cursor:pointer}
.qp-window-row:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 8%,transparent)}
.qp-quick-box{display:flex;align-items:flex-end;gap:6px;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:10px;background:var(--dsw-alias-bg-layer-1,#1a1d24);padding:5px 6px 5px 10px;transition:border-color .15s ease}
.qp-quick-box:focus-within{border-color:#d9b85e;box-shadow:0 0 0 3px rgb(246 227 161 / .14)}
.qp-quick-input{flex:1;min-width:0;min-height:24px;max-height:84px;resize:none;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e9ecf1);font:inherit;font-size:12px;line-height:1.45;outline:none;padding:3px 0;caret-color:#e3c76d}
.qp-quick-input::placeholder{color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.7}
.qp-quick-input:disabled{cursor:not-allowed;opacity:.7}
.qp-quick-actions{display:flex;align-items:center;gap:4px;flex:none}
.qp-send-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:#e7cd8b !important;color:#2a2313 !important;cursor:pointer;flex:none}
.qp-send-btn:disabled{opacity:.35;cursor:default}
.qp-stop-btn{width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1,#2b3039);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-secondary,#98a2b3);cursor:pointer;flex:none}
.qp-stop-btn:hover:not(:disabled){color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-stop-btn:disabled{opacity:.35;cursor:default}
.qp-quick-hint{font-size:9.5px;color:var(--dsw-alias-label-secondary,#98a2b3);opacity:.7;padding-left:2px}
.qp-feed-jump{position:absolute;right:18px;bottom:10px;z-index:3;height:24px;padding:0 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d6bfe) 40%,transparent);background:var(--dsw-alias-bg-overlay,#262b35);color:var(--dsw-alias-brand-primary,#4d6bfe);font:inherit;font-size:10px;cursor:pointer;box-shadow:0 4px 12px rgb(0 0 0 / .25)}
.qp-feed-jump:hover{background:var(--dsw-alias-bg-layer-2,#22262e)}
.qp-bottom-row{display:flex;align-items:center;gap:8px}
.qp-repeat-select{flex:none;width:auto;max-width:96px;padding:0 4px}
.qp-action-group{display:flex;align-items:center;gap:6px;flex:1;min-width:0}
.qp-action-group .qp-btn{flex:1;min-width:0;padding:0 4px}
.qp-composer-btn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);cursor:pointer;flex:none}
.qp-composer-btn:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-side-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#98a2b3);font:inherit;font-size:12px;cursor:pointer;position:relative;flex:none}
.qp-side-btn:hover{background:var(--dsw-alias-bg-layer-2,#22262e);color:var(--dsw-alias-label-primary,#e9ecf1)}
.qp-side-dot{position:absolute;top:4px;right:5px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3ddc97);box-shadow:0 0 0 2px var(--dsw-alias-bg-base,#14161a)}
@media (hover:none){.qp-todo-actions{opacity:1}}
@media (max-width:520px){.qp-panel{max-width:calc(100vw - 16px)}}
@media (prefers-reduced-motion:reduce){.qp-dot.is-live,.qp-caret,.qp-feed-dot,.qp-wheel-current,.qp-due-card{animation:none}.qp-panel,.qp-island,.qp-flash{animation:none;transition:none}}
`

export { CSS }
