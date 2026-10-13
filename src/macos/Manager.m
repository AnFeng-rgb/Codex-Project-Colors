#import <Cocoa/Cocoa.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface ColorManager : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSTextField *statusLabel;
@property NSTextField *detailLabel;
@property NSButton *startButton;
@property NSButton *toggleButton;
@property NSButton *stopButton;
@property NSString *node;
@property NSString *tool;
@property NSString *dataDir;
@property NSString *legacyRuntime;
@property NSTimer *timer;
@property BOOL busy;
@property BOOL paused;
@property NSString *requestedWindowURL;
@property BOOL running;
@property BOOL installed;
@property BOOL automatic;
@property BOOL watcherRunning;
@property NSString *importData;
@property BOOL initialPaused;
@property NSInteger smokeStep;
@property NSDate *smokeStarted;
@property NSString *smokeOutput;
@property NSMutableArray *smokeResults;
@end

@implementation ColorManager
- (NSTextField *)label:(NSString *)text frame:(NSRect)frame size:(CGFloat)size {
    NSTextField *label = [NSTextField wrappingLabelWithString:text];
    label.frame=frame; label.font=[NSFont systemFontOfSize:size];
    [self.window.contentView addSubview:label]; return label;
}
- (NSButton *)button:(NSString *)title action:(SEL)action frame:(NSRect)frame {
    NSButton *button=[NSButton buttonWithTitle:title target:self action:action];
    button.bezelStyle=NSBezelStyleRounded; button.frame=frame;
    [self.window.contentView addSubview:button]; return button;
}
- (NSString *)detectNode {
    NSData *settingsData=[NSData dataWithContentsOfFile:[self.dataDir stringByAppendingPathComponent:@"settings.json"]];
    NSDictionary *settings=settingsData?[NSJSONSerialization JSONObjectWithData:settingsData options:0 error:nil]:nil;
    if(settings&&![settings isKindOfClass:NSDictionary.class])return nil;
    NSMutableArray *candidates=[NSMutableArray array];
    [candidates addObject:[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"node"]];
    if([settings[@"nodePath"] isKindOfClass:NSString.class]) [candidates addObject:settings[@"nodePath"]];
    NSString *environment=NSProcessInfo.processInfo.environment[@"COLOR_LABELS_NODE"];
    if(environment) [candidates addObject:environment];
    [candidates addObjectsFromArray:@[[NSHomeDirectory() stringByAppendingPathComponent:@".local/bin/node"], @"/opt/homebrew/bin/node", @"/usr/local/bin/node", @"/Applications/ChatGPT.app/Contents/Resources/cua_node/bin/node"]];
    for(NSString *candidate in candidates) {
        if(![NSFileManager.defaultManager isExecutableFileAtPath:candidate])continue;
        NSTask *task=[NSTask new]; task.executableURL=[NSURL fileURLWithPath:candidate]; task.arguments=@[@"--version"];
        NSPipe *pipe=[NSPipe pipe]; task.standardOutput=pipe; task.standardError=[NSFileHandle fileHandleWithNullDevice];
        if(![task launchAndReturnError:nil])continue;
        NSData *data=[pipe.fileHandleForReading readDataToEndOfFile]; [task waitUntilExit];
        NSString *version=[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        if(task.terminationStatus==0 && [version hasPrefix:@"v"] && [[version substringFromIndex:1] integerValue]>=24)return candidate;
    }
    return nil;
}
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSString *bundle=NSBundle.mainBundle.bundlePath;
    NSString *project=[[bundle stringByDeletingLastPathComponent] stringByDeletingLastPathComponent];
    self.importData=[project stringByAppendingPathComponent:@"data"];
    self.dataDir=[NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/CodexProjectColors"];
    self.legacyRuntime=[project stringByAppendingPathComponent:@"demo/runtime"];
    self.tool=[NSBundle.mainBundle.resourcePath stringByAppendingPathComponent:@"tool/src/cli.mjs"];
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,540,350)
        styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable
        backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"Codex 项目配色"; [self.window center];
    NSTextField *title=[self label:@"项目颜色" frame:NSMakeRect(28,288,480,34) size:24];
    title.font=[NSFont boldSystemFontOfSize:24];
    [self label:@"为 Codex 本地项目设置颜色" frame:NSMakeRect(28,260,480,24) size:13].textColor=NSColor.secondaryLabelColor;
    self.statusLabel=[self label:@"正在读取状态…" frame:NSMakeRect(28,219,480,28) size:17];
    self.statusLabel.font=[NSFont systemFontOfSize:17 weight:NSFontWeightSemibold];
    self.detailLabel=[self label:@"" frame:NSMakeRect(28,142,480,64) size:13];
    self.detailLabel.textColor=NSColor.secondaryLabelColor;
    self.startButton=[self button:@"安装并启用" action:@selector(start:) frame:NSMakeRect(23,99,145,36)];
    self.toggleButton=[self button:@"暂停上色" action:@selector(toggle:) frame:NSMakeRect(185,99,145,36)];
    self.stopButton=[self button:@"停止上色" action:@selector(stop:) frame:NSMakeRect(348,99,145,36)];
    [self button:@"打开配色文件夹" action:@selector(openData:) frame:NSMakeRect(23,53,160,30)];
    [self button:@"更多操作…" action:@selector(more:) frame:NSMakeRect(188,53,140,30)];
    [self label:@"一次安装后，从官方图标打开即可自动接入；刚启动时可能正常重开一次。"
        frame:NSMakeRect(28,16,490,32) size:11].textColor=NSColor.secondaryLabelColor;
    NSMenu *menu=[NSMenu new], *application=[NSMenu new];
    NSMenuItem *root=[NSMenuItem new]; root.submenu=application; [menu addItem:root];
    [application addItemWithTitle:@"关闭管理窗口" action:@selector(terminate:) keyEquivalent:@"q"];
    NSApp.mainMenu=menu;
    self.node=[self detectNode];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES];
    if(!self.node) {
        self.statusLabel.stringValue=@"需要运行环境";
        self.detailLabel.stringValue=@"未找到 Node.js 24 或更新版本。点击“更多操作”选择已有的 Node 可执行文件，或安装 Node.js 24 后重新打开。";
        self.startButton.enabled=NO;self.toggleButton.enabled=NO;self.stopButton.enabled=NO;
    }else {
        [self execute:@"status" quiet:YES];
        self.timer=[NSTimer scheduledTimerWithTimeInterval:2 target:self selector:@selector(poll:) userInfo:nil repeats:YES];
    }
    NSArray *args=NSProcessInfo.processInfo.arguments;
    NSUInteger info=[args indexOfObject:@"--window-info"];
    if(info!=NSNotFound&&info+1<args.count){
        NSData *data=[NSJSONSerialization dataWithJSONObject:@{@"windowNumber":@(self.window.windowNumber)} options:0 error:nil];[data writeToFile:args[info+1] atomically:YES];
    }
    NSUInteger smoke=[args indexOfObject:@"--smoke"];
    if(smoke!=NSNotFound&&smoke+1<args.count){
        self.smokeOutput=args[smoke+1];self.smokeStarted=[NSDate date];self.smokeResults=[NSMutableArray new];
        [NSTimer scheduledTimerWithTimeInterval:0.25 target:self selector:@selector(smoke:) userInfo:nil repeats:YES];
    }
    NSUInteger index=[args indexOfObject:@"--snapshot"];
    if(index!=NSNotFound && index+1<args.count) {
        NSString *output=args[index+1];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,3*NSEC_PER_SEC),dispatch_get_main_queue(),^{
            NSView *view=self.window.contentView;
            NSBitmapImageRep *rep=[view bitmapImageRepForCachingDisplayInRect:view.bounds];
            [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
            [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:output atomically:YES];
            [NSApp terminate:nil];
        });
    }
}
- (void)showError:(NSString *)message {
    NSAlert *alert=[NSAlert new];alert.messageText=@"操作未完成";alert.informativeText=message?:@"请稍后重试。";
    [alert addButtonWithTitle:@"知道了"];[alert beginSheetModalForWindow:self.window completionHandler:nil];
}
- (void)applyState:(NSDictionary *)state {
    NSDictionary *installation=state[@"installation"]?:state;
    self.installed=[installation[@"installed"] boolValue];self.automatic=[installation[@"automatic"] boolValue];self.watcherRunning=[installation[@"watcherRunning"] boolValue];
    NSDictionary *renderer=state[@"renderer"];
    self.paused=[renderer[@"paused"] boolValue];
    BOOL running=state[@"running"]?[state[@"running"] boolValue]:[renderer[@"connected"] boolValue];
    BOOL connected=running&&[renderer[@"connected"] boolValue]&&[renderer[@"ready"] boolValue];
    self.running=running;
    self.startButton.enabled=!self.automatic||!self.watcherRunning;
    self.startButton.title=!self.installed?@"安装并启用":self.automatic?@"自动配色已启用":@"启用自动配色";
    self.stopButton.enabled=running||self.automatic;self.stopButton.title=@"停用自动配色";self.toggleButton.enabled=connected;
    self.toggleButton.title=self.paused?@"恢复上色":@"暂停上色";
    if(![state[@"ok"] boolValue]) {
        self.statusLabel.stringValue=@"需要处理";
        self.detailLabel.stringValue=state[@"detail"]?:@"无法读取状态。"; return;
    }
    NSString *status=state[@"status"]?:@"未连接";
    if(self.automatic&&!connected)status=@"自动配色已启用";
    if(self.automatic&&!self.watcherRunning)status=@"启动助手等待恢复";
    if(renderer[@"error"]&&[renderer[@"error"] length])status=@"保存需要处理";
    else if(connected)status=self.paused?@"上色已暂停":([renderer[@"saving"] boolValue]?@"正在保存配色…":@"已连接");
    self.statusLabel.stringValue=status;
    NSString *detail=state[@"detail"];
    if(renderer[@"error"]&&[renderer[@"error"] length])detail=renderer[@"error"];
    if(!detail.length)detail=connected?@"关闭管理窗口后自动配色继续运行。配色保存在用户资料目录，并保留备份。":self.automatic?@"等待官方应用启动。已经打开且没有连接接口的工作窗口会保留；下次从官方图标打开后接入。":@"点击安装并启用：安装到个人应用程序目录，注册登录后的启动观察助手。不会退出当前工作窗口。";
    self.detailLabel.stringValue=detail;
}
- (void)execute:(NSString *)action quiet:(BOOL)quiet {
    if(self.busy||!self.node)return;self.busy=YES;
    if(!quiet) {self.statusLabel.stringValue=@"正在处理…";self.startButton.enabled=NO;self.toggleButton.enabled=NO;self.stopButton.enabled=NO;}
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
        @autoreleasepool {
            NSTask *task=[NSTask new];task.executableURL=[NSURL fileURLWithPath:self.node];
            NSMutableArray *arguments=[NSMutableArray arrayWithObjects:self.tool,action,nil];
            if([action isEqualToString:@"install-auto"])[arguments addObjectsFromArray:@[@"--bundle",NSBundle.mainBundle.bundlePath,@"--import-data",self.importData]];
            if([action isEqualToString:@"select-window"]&&self.requestedWindowURL)[arguments addObject:self.requestedWindowURL];
            [arguments addObjectsFromArray:@[@"--data-dir",self.dataDir,@"--legacy-runtime",self.legacyRuntime]];
            task.arguments=arguments;
            NSPipe *out=[NSPipe pipe];task.standardOutput=out;task.standardError=[NSFileHandle fileHandleWithNullDevice];
            NSError *error=nil;NSDictionary *state=nil;
            if([task launchAndReturnError:&error]) {
                NSData *data=[out.fileHandleForReading readDataToEndOfFile];[task waitUntilExit];
                state=[NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
            }
            if(!state)state=@{@"ok":@NO,@"detail":error.localizedDescription?:@"后台没有返回有效结果。"};
            dispatch_async(dispatch_get_main_queue(),^{
                self.busy=NO;
                if([action isEqualToString:@"uninstall-auto"]&&[state[@"ok"] boolValue]){[self.timer invalidate];[NSApp terminate:nil];return;}
                if([action isEqualToString:@"windows"]&&[state[@"ok"] boolValue]){[self presentWindows:state[@"windows"]];return;}
                [self applyState:state];
                if(!quiet&&![state[@"ok"] boolValue]&&!self.smokeOutput)[self showError:state[@"detail"]];
            });
        }
    });
}
- (void)poll:(NSTimer *)timer {[self execute:@"status" quiet:YES];}
- (void)start:(id)sender {
    [self confirm:self.installed?@"启用自动配色？":@"安装并启用自动配色？" detail:@"以后仍使用官方图标。登录后助手会观察启动；仅对刚启动、前台且未操作的应用请求正常退出，再带连接参数重开一次。已有工作窗口、发生过输入或拒绝退出时会跳过，不强制退出。程序与运行环境安装到个人应用程序目录，配色独立保留；可随时停用或卸载。" action:self.installed?@"enable-auto":@"install-auto"];
}
- (void)toggle:(id)sender {[self execute:self.paused?@"resume":@"pause" quiet:NO];}
- (void)stop:(id)sender {[self execute:@"disable-auto" quiet:NO];}
- (void)openData:(id)sender {
    [NSFileManager.defaultManager createDirectoryAtPath:self.dataDir withIntermediateDirectories:YES attributes:nil error:nil];
    [NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:self.dataDir]];
}
- (void)more:(id)sender {
    NSMenu *menu=[NSMenu new];
    for(NSArray *entry in @[@[@"选择连接窗口…",NSStringFromSelector(@selector(chooseWindow:))],@[@"手动重新连接",NSStringFromSelector(@selector(reconnect:))],@[@"选择官方应用…",NSStringFromSelector(@selector(chooseApplication:))],@[@"清除全部配色…",NSStringFromSelector(@selector(clear:))],@[@"恢复上一版备份…",NSStringFromSelector(@selector(restore:))],@[@"查看运行记录",NSStringFromSelector(@selector(openLogs:))],@[@"卸载自动配色…",NSStringFromSelector(@selector(uninstall:))]]) {
        NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:entry[0] action:NSSelectorFromString(entry[1]) keyEquivalent:@""];item.target=self;[menu addItem:item];
    }
    [menu popUpMenuPositioningItem:nil atLocation:NSMakePoint(0,0) inView:sender];
}
- (void)reconnect:(id)sender {[self execute:@"start" quiet:NO];}
- (void)uninstall:(id)sender {[self confirm:@"卸载自动配色？" detail:@"停止后台并移除本工具的登录助手和已安装程序。保留配色与备份，不修改官方应用或 Dock 图标。" action:@"uninstall-auto"];
}
- (void)chooseApplication:(id)sender {
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseDirectories=NO;panel.allowedContentTypes=@[UTTypeApplicationBundle];panel.allowsMultipleSelection=NO;panel.message=@"选择需要配色的官方应用。正在运行的窗口不会被退出。选择后重新启用自动配色。";
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){
        if(response!=NSModalResponseOK)return;
        NSString *file=[self.dataDir stringByAppendingPathComponent:@"settings.json"];NSData *previous=[NSData dataWithContentsOfFile:file];
        NSMutableDictionary *settings=previous?[[NSJSONSerialization JSONObjectWithData:previous options:NSJSONReadingMutableContainers error:nil] mutableCopy]:[NSMutableDictionary new];
        if(![settings isKindOfClass:NSMutableDictionary.class]){[self showError:@"设置无法读取，原文件保留。"];return;}
        settings[@"appPath"]=panel.URL.path;[settings removeObjectForKey:@"windowURL"];
        [NSFileManager.defaultManager createDirectoryAtPath:self.dataDir withIntermediateDirectories:YES attributes:nil error:nil];
        [[NSJSONSerialization dataWithJSONObject:settings options:NSJSONWritingPrettyPrinted error:nil] writeToFile:file atomically:YES];
        if(self.automatic)[self execute:@"enable-auto" quiet:NO];
    }];
}
- (void)chooseWindow:(id)sender {[self execute:@"windows" quiet:NO];}
- (void)presentWindows:(NSArray *)windows {
    if(!windows.count){[self showError:@"没有找到带侧边栏的主窗口。请先从本工具开启应用的调试接口。"];return;}
    NSAlert *alert=[NSAlert new];alert.messageText=@"选择需要配色的窗口";
    alert.informativeText=@"首阶段只管理你选定的这个窗口，其他窗口保持原样。选择后点击开启配色。";
    NSPopUpButton *popup=[[NSPopUpButton alloc] initWithFrame:NSMakeRect(0,0,350,28) pullsDown:NO];
    for(NSDictionary *window in windows){[popup addItemWithTitle:window[@"title"]];popup.lastItem.representedObject=window[@"url"];}
    alert.accessoryView=popup;[alert addButtonWithTitle:@"使用此窗口"];[alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){
        if(response==NSAlertFirstButtonReturn){self.requestedWindowURL=popup.selectedItem.representedObject;[self execute:@"select-window" quiet:NO];}
        else [self execute:@"status" quiet:YES];
    }];
}
- (void)chooseNode:(id)sender {
    NSOpenPanel *panel=[NSOpenPanel openPanel];panel.canChooseDirectories=NO;panel.allowsMultipleSelection=NO;
    panel.message=@"选择已安装的 Node.js 24 或更新版本的 node 可执行文件，用于运行本机配色后台。";
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){
        if(response!=NSModalResponseOK)return;
        NSString *file=[self.dataDir stringByAppendingPathComponent:@"settings.json"];
        NSData *previous=[NSData dataWithContentsOfFile:file];
        NSMutableDictionary *settings=previous?[[NSJSONSerialization JSONObjectWithData:previous options:NSJSONReadingMutableContainers error:nil] mutableCopy]:[NSMutableDictionary new];
        if(![settings isKindOfClass:NSMutableDictionary.class]){[self showError:@"运行设置无法读取，已保留原文件。请先检查配色文件夹中的 settings.json。"];return;}
        settings[@"nodePath"]=panel.URL.path;
        [NSFileManager.defaultManager createDirectoryAtPath:self.dataDir withIntermediateDirectories:YES attributes:nil error:nil];
        NSData *data=[NSJSONSerialization dataWithJSONObject:settings options:NSJSONWritingPrettyPrinted error:nil];
        // JSON settings are read by both the native manager and Node.
        [data writeToFile:file atomically:YES];
        self.node=[self detectNode];
        if(!self.node){[self showError:@"所选文件不是可用的 Node.js 24 运行环境。请重新选择。"];return;}
        if(!self.timer)self.timer=[NSTimer scheduledTimerWithTimeInterval:2 target:self selector:@selector(poll:) userInfo:nil repeats:YES];
        [self execute:@"status" quiet:YES];
    }];
}
- (void)confirm:(NSString *)message detail:(NSString *)detail action:(NSString *)action {
    NSAlert *alert=[NSAlert new];alert.messageText=message;alert.informativeText=detail;
    [alert addButtonWithTitle:@"继续"];[alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse response){if(response==NSAlertFirstButtonReturn)[self execute:action quiet:NO];}];
}
- (void)clear:(id)sender {[self confirm:@"清除全部配色？" detail:@"会恢复所有项目的默认外观。暂停上色可保留设置；上一次文件备份仍保留。" action:@"clear"];}
- (void)restore:(id)sender {[self confirm:@"恢复上一版配色备份？" detail:@"会先停止上色，并保留当前文件，再恢复上一份备份。恢复后点击开启配色。" action:@"restore-backup"];}
- (void)openLogs:(id)sender {[NSWorkspace.sharedWorkspace openURL:[NSURL fileURLWithPath:[self.dataDir stringByAppendingPathComponent:@"runtime"]]];}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {return YES;}
- (void)finishSmoke:(BOOL)passed message:(NSString *)message {
    NSDictionary *report=@{@"passed":@(passed),@"message":message,@"checks":self.smokeResults?:@[]};
    NSData *data=[NSJSONSerialization dataWithJSONObject:report options:NSJSONWritingPrettyPrinted error:nil];[data writeToFile:self.smokeOutput atomically:YES];
    NSView *view=self.window.contentView;NSBitmapImageRep *rep=[view bitmapImageRepForCachingDisplayInRect:view.bounds];
    [view cacheDisplayInRect:view.bounds toBitmapImageRep:rep];
    [[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToFile:[[self.smokeOutput stringByDeletingLastPathComponent] stringByAppendingPathComponent:@"manager.png"] atomically:YES];
    [NSApp terminate:nil];
}
- (void)smoke:(NSTimer *)timer {
    if(-self.smokeStarted.timeIntervalSinceNow>35){[self finishSmoke:NO message:@"原生按钮流程超时"];return;}
    if(self.busy)return;
    if(self.smokeStep==0){
        if(!self.running||!self.toggleButton.enabled)return;
        self.initialPaused=self.paused;self.smokeStep=1;[self.toggleButton performClick:nil];return;
    }
    NSString *name;BOOL passed;
    if(self.smokeStep==1){name=@"原生暂停/恢复按钮修改状态并保存";passed=self.paused!=self.initialPaused;}
    else if(self.smokeStep==2){name=@"再次点击恢复初始暂停状态";passed=self.paused==self.initialPaused;}
    else if(self.smokeStep==3){name=@"原生停止按钮停止后台";passed=!self.running;}
    else {name=@"原生开启按钮重新加载配色";passed=self.running&&self.paused==self.initialPaused;}
    [self.smokeResults addObject:@{@"name":name,@"passed":@(passed)}];
    if(!passed){[self finishSmoke:NO message:self.detailLabel.stringValue];return;}
    if(self.smokeStep==1){self.smokeStep=2;[self.toggleButton performClick:nil];}
    else if(self.smokeStep==2){self.smokeStep=3;[self.stopButton performClick:nil];}
    else if(self.smokeStep==3){self.smokeStep=4;[self.startButton performClick:nil];}
    else [self finishSmoke:YES message:@"真实原生按钮通过；管理窗口关闭后后台继续运行"];
}
@end

int main(int argc,const char *argv[]) {
    @autoreleasepool {
        NSApplication *app=NSApplication.sharedApplication;[app setActivationPolicy:NSApplicationActivationPolicyRegular];
        ColorManager *manager=[ColorManager new];app.delegate=manager;[app run];
    }
    return 0;
}
