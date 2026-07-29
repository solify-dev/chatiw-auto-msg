from seleniumbase import SB
import time
import json

with SB(uc=True, test=True, locale="en") as sb:
    url = "https://www.chatiw.com/"
    print("Opening", url)
    sb.uc_open_with_reconnect(url, 4)
    try:
        sb.uc_gui_click_captcha()
    except Exception as e:
        print("uc_gui_click_captcha:", e)

    for i in range(30):
        title = sb.get_title()
        print(f"[{i}] {title} | {sb.get_current_url()}")
        if "Just a moment" not in title and "Attention" not in title:
            body = sb.get_text("body")[:200]
            if "security verification" not in body.lower():
                print("PASSED CF")
                break
        try:
            sb.uc_gui_click_captcha()
        except Exception:
            pass
        time.sleep(2)

    sb.save_screenshot("sb-cf.png")
    info = {
        "title": sb.get_title(),
        "url": sb.get_current_url(),
        "has_submit": sb.is_element_present("#submit_btn"),
        "has_nickname": sb.is_element_present('input[name="nickname"]'),
        "body": sb.get_text("body")[:500],
    }
    print(json.dumps(info, indent=2))
    with open("sb-info.json", "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
    time.sleep(3)
