import hashlib
import ipaddress
import re
import socket
from dataclasses import dataclass
from urllib.parse import urlparse

PROMPT_INJECTION_PATTERNS = (
    re.compile(r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions", re.I),
    re.compile(r"(system|developer)\s+(message|prompt|instructions?)", re.I),
    re.compile(r"you\s+are\s+now\s+(?:an?|the)", re.I),
    re.compile(r"reveal\s+(?:your\s+)?(?:prompt|secrets?|api\s*keys?)", re.I),
    re.compile(r"do\s+not\s+(?:tell|inform)\s+(?:the\s+)?user", re.I),
    re.compile(r"execute\s+(?:this|the\s+following)\s+(?:command|code)", re.I),
    re.compile(r"<\s*(?:system|assistant|developer)\s*>", re.I),
)


@dataclass(frozen=True)
class UrlSafety:
    safe: bool
    reason: str | None = None


def validate_public_url(url: str, allow_private: bool = False) -> UrlSafety:
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return UrlSafety(False, "Only HTTP(S) URLs are allowed")
        if parsed.username or parsed.password:
            return UrlSafety(False, "URLs containing credentials are blocked")
        if not parsed.hostname:
            return UrlSafety(False, "URL has no hostname")
        hostname = parsed.hostname.rstrip(".").lower()
        if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".local"):
            return UrlSafety(False, "Local hostnames are blocked")

        addresses = {info[4][0] for info in socket.getaddrinfo(hostname, None)}
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if not allow_private and (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                return UrlSafety(False, f"Private or reserved address blocked: {address}")
        return UrlSafety(True)
    except (ValueError, OSError) as error:
        return UrlSafety(False, f"URL could not be safely resolved: {error}")


def detect_prompt_injection(text: str) -> list[str]:
    sample = text[:250_000]
    findings: list[str] = []
    for pattern in PROMPT_INJECTION_PATTERNS:
        if pattern.search(sample):
            findings.append(pattern.pattern)
    return findings


def content_fingerprint(text: str) -> str:
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    return hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()


def quote_untrusted(text: str, max_characters: int = 16_000) -> str:
    """Wrap evidence so models cannot mistake webpage content for control instructions."""
    clipped = text[:max_characters]
    return f"<untrusted_evidence>\n{clipped}\n</untrusted_evidence>"
