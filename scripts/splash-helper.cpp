#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <shellapi.h>
#include <gdiplus.h>
#include <string>

namespace {
constexpr int width = 680;
constexpr int height = 360;
Gdiplus::Bitmap* background = nullptr;
std::wstring readyFile;
DWORD startedAt = 0;
int dotCount = 0;

LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM word, LPARAM longValue) {
  switch (message) {
    case WM_TIMER:
      if (word == 1) {
        dotCount = (dotCount + 1) % 4;
        InvalidateRect(window, nullptr, FALSE);
      } else if (word == 2 &&
                 (GetFileAttributesW(readyFile.c_str()) != INVALID_FILE_ATTRIBUTES ||
                  GetTickCount() - startedAt > 60000)) {
        DestroyWindow(window);
      }
      return 0;
    case WM_PAINT: {
      PAINTSTRUCT paint;
      HDC dc = BeginPaint(window, &paint);
      Gdiplus::Graphics graphics(dc);
      graphics.SetInterpolationMode(Gdiplus::InterpolationModeHighQualityBicubic);
      if (background) graphics.DrawImage(background, 0, 0, width, height);
      Gdiplus::FontFamily family(L"Segoe UI");
      Gdiplus::Font font(&family, 17.0f, Gdiplus::FontStyleRegular, Gdiplus::UnitPixel);
      Gdiplus::SolidBrush brush(Gdiplus::Color(255, 239, 246, 244));
      const std::wstring status = L"Başlatılıyor" + std::wstring(dotCount, L'.');
      graphics.SetTextRenderingHint(Gdiplus::TextRenderingHintAntiAliasGridFit);
      graphics.DrawString(status.c_str(), -1, &font, Gdiplus::PointF(42.0f, 304.0f), &brush);
      EndPaint(window, &paint);
      return 0;
    }
    case WM_DESTROY:
      KillTimer(window, 1);
      KillTimer(window, 2);
      PostQuitMessage(0);
      return 0;
    default:
      return DefWindowProcW(window, message, word, longValue);
  }
}
}

int WINAPI WinMain(HINSTANCE instance, HINSTANCE, LPSTR, int) {
  int count = 0;
  LPWSTR* args = CommandLineToArgvW(GetCommandLineW(), &count);
  if (!args || count != 3) {
    if (args) LocalFree(args);
    return 1;
  }
  const std::wstring imagePath = args[1];
  readyFile = args[2];
  LocalFree(args);

  Gdiplus::GdiplusStartupInput input;
  ULONG_PTR gdiplusToken = 0;
  if (Gdiplus::GdiplusStartup(&gdiplusToken, &input, nullptr) != Gdiplus::Ok) return 1;
  Gdiplus::Bitmap bitmap(imagePath.c_str());
  if (bitmap.GetLastStatus() != Gdiplus::Ok) {
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 1;
  }
  background = &bitmap;

  WNDCLASSEXW windowClass = {};
  windowClass.cbSize = sizeof(windowClass);
  windowClass.hInstance = instance;
  windowClass.lpfnWndProc = windowProc;
  windowClass.lpszClassName = L"GreenLauncherSplash";
  windowClass.hCursor = LoadCursor(nullptr, IDC_ARROW);
  if (!RegisterClassExW(&windowClass)) {
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 1;
  }

  const int x = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;
  const int y = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;
  HWND window = CreateWindowExW(WS_EX_TOOLWINDOW | WS_EX_TOPMOST, windowClass.lpszClassName,
                                L"Green Launcher loading", WS_POPUP, x, y, width, height,
                                nullptr, nullptr, instance, nullptr);
  if (!window) {
    Gdiplus::GdiplusShutdown(gdiplusToken);
    return 1;
  }
  startedAt = GetTickCount();
  SetTimer(window, 1, 380, nullptr);
  SetTimer(window, 2, 100, nullptr);
  InvalidateRect(window, nullptr, FALSE);
  UpdateWindow(window);
  ShowWindow(window, SW_SHOWNORMAL);
  UpdateWindow(window);
  MSG message;
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  background = nullptr;
  Gdiplus::GdiplusShutdown(gdiplusToken);
  return 0;
}
