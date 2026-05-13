(*
  scripts/jarvis/window-arrange.applescript

  Pixel-perfect window layout. Skips processes that aren't running or
  don't have a front window. Errors are silently caught — never fails loud.

  Layout (1920x1080 single display):
    [VS Code:           0..960  full height]
    [Terminal/iTerm2:  960..1440 full height]   ← Claude Code lives here
    [Chrome (Tolik):  1440..1920 full height]

  Adjust SCREEN_WIDTH / SCREEN_HEIGHT for ultrawide / multi-monitor.
*)

set MENU_BAR to 28
set SCREEN_WIDTH to 1920
set SCREEN_HEIGHT to 1080

on isRunning(appName)
  tell application "System Events"
    return (name of processes) contains appName
  end tell
end isRunning

on hasFrontWindow(appName)
  try
    tell application "System Events"
      tell process appName
        return (count of windows) > 0
      end tell
    end tell
  on error
    return false
  end try
end hasFrontWindow

on arrangeIfPresent(appName, x, y, w, h)
  try
    if my isRunning(appName) and my hasFrontWindow(appName) then
      tell application "System Events"
        tell process appName
          set position of front window to {x, y}
          set size of front window to {w, h}
        end tell
      end tell
      return appName & " arranged"
    else
      return appName & " skipped (not running or no window)"
    end if
  on error errMsg
    return appName & " error: " & errMsg
  end try
end arrangeIfPresent

set results to {}
copy my arrangeIfPresent("Code", 0, MENU_BAR, 960, SCREEN_HEIGHT - MENU_BAR) to end of results
copy my arrangeIfPresent("iTerm2", 960, MENU_BAR, 480, SCREEN_HEIGHT - MENU_BAR) to end of results
copy my arrangeIfPresent("Terminal", 960, MENU_BAR, 480, SCREEN_HEIGHT - MENU_BAR) to end of results
copy my arrangeIfPresent("Google Chrome", 1440, MENU_BAR, SCREEN_WIDTH - 1440, SCREEN_HEIGHT - MENU_BAR) to end of results

return results
