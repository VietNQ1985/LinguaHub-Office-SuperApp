//! URL rules (port of shared/navigation.ts, teams-meeting-permissions.ts, workspace-unread.ts).

use url::Url;

pub const SERVICES: [&str; 7] = [
    "whatsapp", "telegram", "teams", "outlook", "zalo", "zoom", "meet",
];

pub fn start_url(service: &str) -> &'static str {
    match service {
        "whatsapp" => "https://web.whatsapp.com",
        "teams" => "https://teams.microsoft.com",
        "outlook" => "https://outlook.office.com/mail/",
        "telegram" => "https://web.telegram.org/k/",
        "zalo" => "https://chat.zalo.me/",
        "zoom" => "https://zoom.us/signin",
        _ => "https://accounts.google.com/ServiceLogin?service=grandcentral&continue=https%3A%2F%2Fmeet.google.com%2F",
    }
}

pub fn app_name(service: &str) -> &'static str {
    match service {
        "whatsapp" => "WhatsApp",
        "teams" => "Teams",
        "outlook" => "Outlook",
        "telegram" => "Telegram",
        "zoom" => "Zoom",
        "zalo" => "Zalo",
        _ => "Google Meet",
    }
}

/// Google sign-in hops through country domains (accounts.google.com.vn) and accounts.youtube.com
/// to store the session; blocking them leaves the password step hanging.
fn google_sign_in_host(host: &str) -> bool {
    host == "accounts.youtube.com"
        || regex::Regex::new(r"^accounts\.google\.(com|[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$")
            .unwrap()
            .is_match(host)
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.ends_with(&format!(".{domain}"))
}

pub fn is_workspace_url(service: &str, value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_lowercase();
    match service {
        // zoom.us redirects to zoom.com; Zoom sign-in may go through Google.
        "zoom" => {
            host_matches(&host, "zoom.us")
                || host_matches(&host, "zoom.com")
                || google_sign_in_host(&host)
        }
        "meet" => host == "meet.google.com" || google_sign_in_host(&host),
        "zalo" => {
            url.port().is_none()
                && [
                    "chat.zalo.me",
                    "id.zalo.me",
                    "jr.zaloapp.com",
                    "jr.chat.zalo.me",
                ]
                .contains(&host.as_str())
        }
        "whatsapp" => host_matches(&host, "whatsapp.com"),
        // Telegram Web (K and A clients); sign-in happens on the same host.
        "telegram" => host == "web.telegram.org" && url.port().is_none(),
        // Outlook on the web (work and personal) plus Microsoft sign-in.
        "outlook" => [
            "outlook.com",
            "office.com",
            "office365.com",
            "office.net",
            "microsoft.com",
            "microsoftonline.com",
            "live.com",
            "cloud.microsoft",
        ]
        .iter()
        .any(|domain| host_matches(&host, domain)),
        "teams" => [
            "microsoft.com",
            "microsoftonline.com",
            "live.com",
            "cloud.microsoft",
        ]
        .iter()
        .any(|domain| host_matches(&host, domain)),
        _ => false,
    }
}

pub fn is_safe_external_web_url(value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let host = host.trim_end_matches('.');
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.contains(':')
        || host.starts_with('[')
    {
        return false;
    }
    let parts: Vec<Option<u8>> = host
        .split('.')
        .map(|part| part.parse::<u8>().ok())
        .collect();
    if parts.len() == 4 && parts.iter().all(Option::is_some) {
        let (first, second) = (parts[0].unwrap(), parts[1].unwrap());
        if first == 0
            || first == 10
            || first == 127
            || first >= 224
            || (first == 169 && second == 254)
            || (first == 172 && (16..=31).contains(&second))
            || (first == 192 && second == 168)
        {
            return false;
        }
    }
    true
}

pub fn is_meeting_service(service: &str) -> bool {
    matches!(service, "teams" | "zoom" | "meet")
}

pub fn trusted_meeting_origin(service: &str, value: &str) -> bool {
    let Ok(url) = Url::parse(value) else {
        return false;
    };
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let hosts: &[&str] = match service {
        "teams" => &["teams.microsoft.com", "teams.cloud.microsoft"],
        "zoom" => &["zoom.us", "zoom.com"],
        "meet" => &["meet.google.com"],
        _ => &[],
    };
    hosts.iter().any(|domain| host_matches(&host, domain))
}

/// Only the website's numeric title badge "(3) WhatsApp", never conversation text.
pub fn unread_from_title(title: &str) -> i64 {
    let pattern = regex::Regex::new(r"^\s*[(\[]\s*(\d{1,6})(\+)?\s*[)\]]").unwrap();
    pattern
        .captures(title)
        .and_then(|captures| captures[1].parse::<i64>().ok())
        .map(|count| count.min(999_999))
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_rules() {
        assert!(is_workspace_url("whatsapp", "https://web.whatsapp.com/"));
        assert!(!is_workspace_url("whatsapp", "http://web.whatsapp.com/"));
        assert!(is_workspace_url("zalo", "https://id.zalo.me/account"));
        assert!(!is_workspace_url("zalo", "https://chat.zalo.me:444/"));
        assert!(is_workspace_url("meet", "https://accounts.google.com/x"));
        assert!(is_workspace_url(
            "zoom",
            "https://accounts.google.com.vn/accounts/SetSID"
        ));
        assert!(is_workspace_url(
            "zoom",
            "https://accounts.youtube.com/accounts/SetSID"
        ));
        assert!(!is_workspace_url(
            "zoom",
            "https://accounts.google.com.evil.test/"
        ));
        assert!(!is_workspace_url("meet", "https://www.youtube.com/"));
        assert!(!is_workspace_url(
            "teams",
            "https://evil.com/?teams.microsoft.com"
        ));
        assert!(is_safe_external_web_url("https://example.com/a"));
        assert!(!is_safe_external_web_url("https://192.168.1.2/"));
        assert!(trusted_meeting_origin(
            "zoom",
            "https://us05web.zoom.us/j/1"
        ));
        assert!(is_workspace_url(
            "outlook",
            "https://outlook.office.com/mail/"
        ));
        assert!(is_workspace_url(
            "telegram",
            "https://web.telegram.org/a/#1"
        ));
        assert!(!is_workspace_url("telegram", "https://t.me/abc"));
        assert!(is_workspace_url(
            "outlook",
            "https://login.microsoftonline.com/x"
        ));
        assert!(!is_workspace_url("outlook", "https://outlook.evil.com/"));
        assert_eq!(unread_from_title("(12) WhatsApp"), 12);
        assert_eq!(unread_from_title("WhatsApp"), 0);
    }
}
