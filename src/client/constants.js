    const NS = 'quickPanel'
    const MODE_KEY = 'dsh.quick-panel.m0'
    const POS_KEY = 'dsh.quick-panel.m0.pos'
    const TODO_KEY = 'dsh.quick-panel.m1.todos'
    const REMINDER_KEY = 'dsh.quick-panel.m2.reminders'
    const HOST_ROUTE = '/quick-panel'
    const MODES = ['panel', 'island', 'hidden']
    /**
     * Optional integration with DSH's built-in schedule page. It is off on
     * purpose: the local reminder is the product feature, and the built-in
     * Automation tasks page is not part of this plugin's UI. Turn this on only
     * when the user explicitly asks for agent-delivered reminders.
     */
    const DSH_TASKS_ENABLED = false

export { NS, MODE_KEY, POS_KEY, TODO_KEY, REMINDER_KEY, HOST_ROUTE, MODES, DSH_TASKS_ENABLED }
