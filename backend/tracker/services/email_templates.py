"""Transactional email layout.

Email is a hostile rendering target: no flexbox or grid, no external stylesheets, Outlook renders through
Word, and most clients block remote images until the reader allows them. So this is tables, inline styles,
and a header that still reads as Wyre with every image switched off.
"""
from __future__ import annotations

from html import escape

PURPLE = "#5C3592"
PURPLE_DARK = "#4B2A78"
INK = "#1B1626"
MUTED = "#6B6577"
LINE = "#E6DCF5"
PAPER = "#F4F1F8"
LOGO = "https://tracker.wyreng.com/icons/icon-192.png"


def _button(url: str, label: str) -> str:
    """A 'bulletproof' button: Outlook ignores padding on <a>, so it gets a VML rectangle instead, hidden
    from every other client by the mso conditional."""
    return f"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
          <tr><td align="center" bgcolor="{PURPLE}" style="border-radius:8px;">
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="{url}" style="height:48px;v-text-anchor:middle;width:280px;" arcsize="16%" stroke="f" fillcolor="{PURPLE}">
            <w:anchorlock/><center style="color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:bold;">{escape(label)}</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-- -->
            <a href="{url}" style="background-color:{PURPLE};border-radius:8px;color:#ffffff;display:inline-block;
               font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:48px;
               text-align:center;text-decoration:none;width:280px;-webkit-text-size-adjust:none;">{escape(label)}</a>
            <!--<![endif]-->
          </td></tr>
        </table>"""


def layout(*, preheader: str, heading: str, greeting: str, body_html: str, action: str, url: str,
           note: str, footer: str) -> str:
    """One card on a tinted page. `preheader` is the grey line Gmail shows beside the subject — left
    empty it leaks whatever text comes first, which looks like a mistake."""
    return f"""<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>{escape(heading)}</title>
<!--[if mso]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->
<style>
  @media only screen and (max-width:600px) {{
    .card {{ padding:28px 22px !important; }}
    .h1 {{ font-size:22px !important; }}
  }}
</style>
</head>
<body style="margin:0;padding:0;background-color:{PAPER};-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:{PAPER};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{escape(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:{PAPER};">
  <tr><td align="center" style="padding:32px 16px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">

      <tr><td align="center" style="padding:0 0 22px 0;">
        <img src="{LOGO}" width="40" height="40" alt="Wyre"
             style="display:block;border:0;border-radius:9px;margin:0 auto 10px auto;" />
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1.6px;
                    text-transform:uppercase;color:{PURPLE};font-weight:700;">Wyre Tracker</div>
      </td></tr>

      <tr><td class="card" bgcolor="#FFFFFF" style="background-color:#ffffff;border:1px solid {LINE};
              border-radius:14px;padding:36px 40px;font-family:Helvetica,Arial,sans-serif;">

        <h1 class="h1" style="margin:0 0 6px 0;font-size:26px;line-height:1.25;font-weight:700;color:{INK};">{escape(heading)}</h1>
        <p style="margin:0 0 22px 0;font-size:16px;line-height:1.6;color:{MUTED};">{escape(greeting)}</p>

        {body_html}

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="padding:10px 0 22px 0;">
          {_button(url, action)}
        </td></tr></table>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
               style="background-color:{PAPER};border-radius:8px;">
          <tr><td style="padding:14px 16px;font-family:Helvetica,Arial,sans-serif;">
            <div style="font-size:12px;color:{MUTED};margin-bottom:5px;">Button not working? Paste this into your browser:</div>
            <a href="{url}" style="font-size:12px;color:{PURPLE_DARK};word-break:break-all;line-height:1.5;">{url}</a>
          </td></tr>
        </table>

        <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:{MUTED};
                  border-top:1px solid {LINE};padding-top:18px;">{escape(note)}</p>
      </td></tr>

      <tr><td align="center" style="padding:20px 24px 0 24px;font-family:Helvetica,Arial,sans-serif;
              font-size:12px;line-height:1.6;color:{MUTED};">{escape(footer)}</td></tr>

    </table>
  </td></tr>
</table>
</body></html>"""


def paragraph(text_html: str) -> str:
    return f'<p style="margin:0 0 16px 0;font-size:16px;line-height:1.65;color:{INK};">{text_html}</p>'


def facts(rows: list[tuple[str, str]]) -> str:
    """Label/value pairs — username, who invited you. A definition list is what this is, but tables
    are what email clients actually align."""
    cells = "".join(
        f'<tr><td style="padding:7px 0;font-size:13px;color:{MUTED};width:110px;vertical-align:top;">{escape(k)}</td>'
        f'<td style="padding:7px 0;font-size:15px;color:{INK};font-weight:600;">{escape(v)}</td></tr>'
        for k, v in rows)
    return (f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
            f'style="margin:0 0 22px 0;border-top:1px solid {LINE};border-bottom:1px solid {LINE};'
            f'font-family:Helvetica,Arial,sans-serif;"><tr><td style="padding:4px 0;">'
            f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">{cells}</table>'
            f'</td></tr></table>')
