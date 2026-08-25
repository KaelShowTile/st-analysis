export const getLocalTodayStrSync = () => {
    const tz = window.__USER_TZ__ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return new Date().toLocaleDateString('en-CA', { timeZone: tz });
};

export const getLocalStrFromDate = (date) => {
    const tz = window.__USER_TZ__ || Intl.DateTimeFormat().resolvedOptions().timeZone;
    return date.toLocaleDateString('en-CA', { timeZone: tz });
};
