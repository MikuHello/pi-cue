ObjC.import("Foundation");
function run(argv) {
  let submitting = false;
  try {
    const notice = $.NSUserNotification.alloc.init;
    notice.title = argv[0];
    notice.informativeText = argv[1];
    notice.soundName = $();
    if (!notice.soundName.isNil()) return "not-submitted";
    const center = $.NSUserNotificationCenter.defaultUserNotificationCenter;
    if (!center) return "not-submitted";
    submitting = true;
    center.deliverNotification(notice);
    return "submitted";
  } catch (_) {
    return submitting ? "unknown" : "not-submitted";
  }
}
