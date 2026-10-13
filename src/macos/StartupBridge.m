// Adapted from codex-usage-badge, copyright (c) 2026 Codex Usage Badge contributors.
// MIT; full notice: third-party/codex-usage-badge-LICENSE.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <libproc.h>
#include <sys/sysctl.h>

// Read event counters/timing only, never keyboard content, window titles or screenshots.
static NSArray *eventTypes(void) { return @[@(kCGEventKeyDown), @(kCGEventLeftMouseDown), @(kCGEventRightMouseDown), @(kCGEventOtherMouseDown), @(kCGEventScrollWheel)]; }
static NSString *inputStamp(void) {
    NSMutableArray *parts = [NSMutableArray array];
    for (NSNumber *t in eventTypes()) [parts addObject:[NSString stringWithFormat:@"%llu", (unsigned long long)CGEventSourceCounterForEventType(kCGEventSourceStateCombinedSessionState, t.unsignedIntValue)]];
    return [parts componentsJoinedByString:@":"];
}
static double inputIdleMs(void) {
    double seconds = 1e9;
    for (NSNumber *t in eventTypes()) seconds = fmin(seconds, CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, t.unsignedIntValue));
    return isfinite(seconds) ? seconds * 1000 : 0;
}
static NSString *canonical(NSString *path) { return path.stringByStandardizingPath.stringByResolvingSymlinksInPath; }
static BOOL matches(NSRunningApplication *a, NSString *path) {
    if (!a || a.terminated || ![canonical(a.bundleURL.path) isEqualToString:canonical(path)]) return NO;
    char executable[PROC_PIDPATHINFO_MAXSIZE];
    if (proc_pidpath(a.processIdentifier, executable, sizeof(executable)) <= 0) return NO;
    return [canonical(@(executable)) isEqualToString:canonical(a.executableURL.path)];
}
static NSDictionary *argumentsState(pid_t pid) {
    int mib[] = {CTL_KERN, KERN_PROCARGS2, pid}; size_t size = 0;
    if (sysctl(mib, 3, NULL, &size, NULL, 0) || size > 4*1024*1024 || size < sizeof(int)) return @{@"known":@NO};
    NSMutableData *data = [NSMutableData dataWithLength:size];
    if (sysctl(mib, 3, data.mutableBytes, &size, NULL, 0)) return @{@"known":@NO};
    char *start = data.mutableBytes, *end = start + size, *p = start + sizeof(int);
    int argc = 0; memcpy(&argc, start, sizeof(argc));
    if (argc < 1 || argc > 8192) return @{@"known":@NO};
    while (p < end && *p) p++; // executable path
    while (p < end && !*p) p++;
    NSMutableArray *args = [NSMutableArray array];
    for (int i = 0; i < argc && p < end; i++) {
        size_t n = strnlen(p, end-p); if (p+n >= end) return @{@"known":@NO};
        NSString *s = [[NSString alloc] initWithBytes:p length:n encoding:NSUTF8StringEncoding];
        if (!s) return @{@"known":@NO};
        [args addObject:s]; p += n+1;
    }
    if (args.count != (NSUInteger)argc) return @{@"known":@NO};
    id port = NSNull.null;
    for (NSUInteger i=0; i<args.count; i++) {
        NSString *s = args[i];
        if ([s hasPrefix:@"--remote-debugging-port="]) port = [s substringFromIndex:24];
        if ([s isEqualToString:@"--remote-debugging-port"]) port = i+1<args.count ? args[i+1] : @"";
    }
    return @{@"known":@YES, @"port":port};
}
static NSString *identity(NSRunningApplication *a) {
    return [NSString stringWithFormat:@"%d:%.0f", a.processIdentifier, a.launchDate.timeIntervalSince1970*1000];
}
static double bootedAtMs(void) {
    struct timeval boot; size_t size=sizeof(boot);
    int mib[]={CTL_KERN,KERN_BOOTTIME};
    if (sysctl(mib,2,&boot,&size,NULL,0)) return 0;
    return boot.tv_sec*1000.0+boot.tv_usec/1000.0;
}
static NSDictionary *snapshot(NSString *path) {
    NSMutableArray *apps = [NSMutableArray array];
    NSWorkspace *w = NSWorkspace.sharedWorkspace;
    for (NSRunningApplication *a in w.runningApplications) {
        if (!matches(a,path) || !a.launchDate) continue;
        NSDictionary *args = argumentsState(a.processIdentifier);
        [apps addObject:@{@"pid":@(a.processIdentifier), @"key":identity(a), @"launchedAt":@(a.launchDate.timeIntervalSince1970*1000), @"finishedLaunching":@(a.finishedLaunching), @"argumentsKnown":args[@"known"], @"debugPort":args[@"port"] ?: NSNull.null}];
    }
    return @{@"apps":apps, @"frontmostPid":@(w.frontmostApplication.processIdentifier), @"inputStamp":inputStamp(), @"inputIdleMs":@(inputIdleMs()), @"bootedAt":@(bootedAtMs())};
}
static void output(id object) {
    NSData *d = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
    if (!d) exit(2);
    fwrite(d.bytes,1,d.length,stdout); fputc('\n',stdout); fflush(stdout);
}
int main(int argc, const char *argv[]) { @autoreleasepool {
    if (argc < 3) return 2;
    NSString *action=@(argv[1]), *path=canonical(@(argv[2]));
    if ([action isEqualToString:@"snapshot"]) { output(snapshot(path)); return 0; }
    if ([action isEqualToString:@"watch"]) {
        NSNotificationCenter *center=NSWorkspace.sharedWorkspace.notificationCenter;
        __block NSDictionary *previous=nil;
        __block NSUInteger quietTicks=0;
        void (^emit)(BOOL)=^(BOOL force){
            NSDictionary *current=snapshot(path);
            NSDictionary *identityState=@{@"apps":current[@"apps"],@"frontmostPid":current[@"frontmostPid"]};
            if (force || ![identityState isEqual:previous] || ++quietTicks>=30) {
                previous=identityState; quietTicks=0; output(current);
            }
        };
        for (NSString *name in @[NSWorkspaceDidLaunchApplicationNotification, NSWorkspaceDidTerminateApplicationNotification, NSWorkspaceDidActivateApplicationNotification]) {
            [center addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note){
                NSRunningApplication *a=note.userInfo[NSWorkspaceApplicationKey];
                if ([name isEqualToString:NSWorkspaceDidActivateApplicationNotification] || [canonical(a.bundleURL.path) isEqualToString:path]) emit(YES);
            }];
        }
        // Some builds omit workspace notifications. Check in this persistent native process;
        // only changed app state (or a 30-second heartbeat) wakes the Node controller.
        [NSTimer scheduledTimerWithTimeInterval:1 repeats:YES block:^(NSTimer *timer){ (void)timer; emit(NO); }];
        emit(YES);
        [NSRunLoop.currentRunLoop run]; return 0;
    }
    if ([action isEqualToString:@"quit"] && (argc==6 || argc==7)) {
        NSRunningApplication *a=[NSRunningApplication runningApplicationWithProcessIdentifier:atoi(argv[3])];
        double age = a.launchDate ? (NSDate.date.timeIntervalSince1970-a.launchDate.timeIntervalSince1970)*1000 : INFINITY;
        NSDictionary *args = a ? argumentsState(a.processIdentifier) : @{};
        double boot=bootedAtMs(), now=NSDate.date.timeIntervalSince1970*1000;
        BOOL bootRecovery=argc==7 && [@(argv[6]) isEqualToString:@"boot"] && boot>0 && now>=boot && now-boot<=120000 && a.launchDate.timeIntervalSince1970*1000>=boot;
        // Recheck all guards at the native action boundary. No forceTerminate, kill or app activation.
        BOOL safe = matches(a,path) && a.finishedLaunching && [identity(a) isEqualToString:@(argv[4])] && age>=0 && age<=(bootRecovery?30000:8000) && inputIdleMs()>=age && [inputStamp() isEqualToString:@(argv[5])] && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==a.processIdentifier && [args[@"known"] boolValue] && args[@"port"]==NSNull.null;
        output(@{@"accepted":(safe && [a terminate]) ? @YES : @NO}); return 0;
    }
    if ([action isEqualToString:@"launch"] && argc==6) {
        NSDictionary *current=snapshot(path);
        if ([current[@"apps"] count] || ![current[@"inputStamp"] isEqualToString:@(argv[3])] || [current[@"frontmostPid"] intValue]!=atoi(argv[4])) { output(@{@"launched":@NO}); return 0; }
        NSWorkspaceOpenConfiguration *config=NSWorkspaceOpenConfiguration.configuration;
        config.activates=NO; config.hides=YES; config.addsToRecentItems=NO;
        config.arguments=@[@"--remote-debugging-address=127.0.0.1", [NSString stringWithFormat:@"--remote-debugging-port=%d",atoi(argv[5])]];
        __block BOOL done=NO;
        [NSWorkspace.sharedWorkspace openApplicationAtURL:[NSURL fileURLWithPath:path] configuration:config completionHandler:^(NSRunningApplication *a,NSError *e){
            output(e ? @{@"launched":@NO, @"errorCode":@(e.code)} : @{@"launched":@YES, @"pid":@(a.processIdentifier), @"key":identity(a)}); done=YES;
        }];
        NSDate *deadline=[NSDate dateWithTimeIntervalSinceNow:30];
        while (!done && deadline.timeIntervalSinceNow>0) [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.05]];
        return done?0:3;
    }
    if ([action isEqualToString:@"show"] && argc==8) {
        NSRunningApplication *a=[NSRunningApplication runningApplicationWithProcessIdentifier:atoi(argv[3])];
        NSDictionary *args = a ? argumentsState(a.processIdentifier) : @{};
        double age = a.launchDate ? (NSDate.date.timeIntervalSince1970-a.launchDate.timeIntervalSince1970)*1000 : INFINITY;
        BOOL safe=matches(a,path) && age>=0 && age<=30000 && [identity(a) isEqualToString:@(argv[4])] && [args[@"known"] boolValue] && [args[@"port"] isEqual:@(argv[7])] && [inputStamp() isEqualToString:@(argv[5])] && NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier==atoi(argv[6]);
        if (safe) { [a unhide]; safe=[a activateWithOptions:NSApplicationActivateAllWindows]; }
        output(@{@"shown":safe ? @YES : @NO}); return 0;
    }
    return 2;
} }
