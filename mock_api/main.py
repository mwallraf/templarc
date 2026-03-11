"""
Mock Router Inventory API
=========================
A lightweight FastAPI service that simulates a network device inventory
system. Used for testing Templarc datasource resolver features.

Records are keyed by SERVICEID (format: VT[0-9]{5,6}).
Pre-seeded with VT00000 – VT00009.

Endpoints
---------
GET /devices                          — list all devices (summary)
GET /devices/{service_id}             — full device record
GET /devices/{service_id}/interfaces  — interface list for a device
GET /health                           — healthcheck
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Mock Router Inventory API",
    description="Simulated network device inventory for Templarc datasource testing.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Static device data
# ---------------------------------------------------------------------------

DEVICES = {
    "VT00000": {
        "service_id": "VT00000",
        "hostname": "rtr-lon-core-01.example.com",
        "short_name": "rtr-lon-core-01",
        "management_ip": "192.168.100.1",
        "loopback_ip": "10.255.0.1",
        "snmp_community_ro": "public_lon_ro",
        "snmp_community_rw": "private_lon_rw",
        "location": "London Data Centre 1",
        "site_code": "LON-DC1",
        "country": "GB",
        "vendor": "Cisco",
        "model": "ASR1001-X",
        "os": "IOS-XE",
        "os_version": "17.3.4",
        "role": "core",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65001,
        "ntp_server": "ntp1.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "noc@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.100.1/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.0.1/32",    "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "GigabitEthernet0/0/1",  "ip": "10.0.0.1/30",     "description": "Uplink to core switch LON-DC1", "vrf": ""},
        ],
    },
    "VT00001": {
        "service_id": "VT00001",
        "hostname": "rtr-ams-edge-01.example.com",
        "short_name": "rtr-ams-edge-01",
        "management_ip": "192.168.100.2",
        "loopback_ip": "10.255.0.2",
        "snmp_community_ro": "public_ams_ro",
        "snmp_community_rw": "private_ams_rw",
        "location": "Amsterdam Data Centre 2",
        "site_code": "AMS-DC2",
        "country": "NL",
        "vendor": "Cisco",
        "model": "ISR4451-X",
        "os": "IOS-XE",
        "os_version": "17.6.1",
        "role": "edge",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65002,
        "ntp_server": "ntp1.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "noc@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.100.2/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.0.2/32",    "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "GigabitEthernet0/0/1",  "ip": "10.0.0.5/30",     "description": "Uplink to ISP-A", "vrf": ""},
            {"name": "GigabitEthernet0/0/2",  "ip": "10.0.0.9/30",     "description": "Uplink to ISP-B", "vrf": ""},
        ],
    },
    "VT00002": {
        "service_id": "VT00002",
        "hostname": "rtr-fra-dist-01.example.com",
        "short_name": "rtr-fra-dist-01",
        "management_ip": "192.168.100.3",
        "loopback_ip": "10.255.0.3",
        "snmp_community_ro": "public_fra_ro",
        "snmp_community_rw": "private_fra_rw",
        "location": "Frankfurt Colo 1",
        "site_code": "FRA-CO1",
        "country": "DE",
        "vendor": "Cisco",
        "model": "C8300-2N2S-4T2X",
        "os": "IOS-XE",
        "os_version": "17.9.2",
        "role": "distribution",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65003,
        "ntp_server": "ntp2.example.com",
        "dns_server_primary": "1.1.1.1",
        "dns_server_secondary": "1.0.0.1",
        "contact": "noc@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.100.3/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.0.3/32",    "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "TenGigabitEthernet0/1/0","ip": "10.0.1.1/30",    "description": "Uplink to core-01", "vrf": ""},
        ],
    },
    "VT00003": {
        "service_id": "VT00003",
        "hostname": "rtr-par-cpe-01.example.com",
        "short_name": "rtr-par-cpe-01",
        "management_ip": "192.168.101.1",
        "loopback_ip": "10.255.1.1",
        "snmp_community_ro": "public_par_ro",
        "snmp_community_rw": "private_par_rw",
        "location": "Paris Office HQ",
        "site_code": "PAR-HQ",
        "country": "FR",
        "vendor": "Cisco",
        "model": "ISR1100-6G",
        "os": "IOS-XE",
        "os_version": "17.11.1a",
        "role": "cpe",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65101,
        "ntp_server": "ntp1.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "local-it@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.101.1/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.1.1/32",   "description": "Router-ID", "vrf": ""},
            {"name": "GigabitEthernet0/0/1",  "ip": "dhcp",            "description": "WAN — ISP provided", "vrf": ""},
            {"name": "GigabitEthernet0/0/2",  "ip": "10.10.1.1/24",   "description": "LAN", "vrf": ""},
        ],
    },
    "VT00004": {
        "service_id": "VT00004",
        "hostname": "rtr-mad-cpe-01.example.com",
        "short_name": "rtr-mad-cpe-01",
        "management_ip": "192.168.101.2",
        "loopback_ip": "10.255.1.2",
        "snmp_community_ro": "public_mad_ro",
        "snmp_community_rw": "private_mad_rw",
        "location": "Madrid Branch Office",
        "site_code": "MAD-BR1",
        "country": "ES",
        "vendor": "Cisco",
        "model": "ISR1100-4GLTEGB",
        "os": "IOS-XE",
        "os_version": "17.11.1a",
        "role": "cpe",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65102,
        "ntp_server": "ntp1.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "local-it@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.101.2/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.1.2/32",   "description": "Router-ID", "vrf": ""},
            {"name": "Cellular0/1/0",         "ip": "dhcp",            "description": "LTE WAN — primary", "vrf": ""},
            {"name": "GigabitEthernet0/0/1",  "ip": "10.10.2.1/24",   "description": "LAN", "vrf": ""},
        ],
    },
    "VT00005": {
        "service_id": "VT00005",
        "hostname": "rtr-nyc-core-01.example.com",
        "short_name": "rtr-nyc-core-01",
        "management_ip": "192.168.200.1",
        "loopback_ip": "10.255.100.1",
        "snmp_community_ro": "public_nyc_ro",
        "snmp_community_rw": "private_nyc_rw",
        "location": "New York Data Centre 1",
        "site_code": "NYC-DC1",
        "country": "US",
        "vendor": "Cisco",
        "model": "ASR1002-HX",
        "os": "IOS-XE",
        "os_version": "17.6.3a",
        "role": "core",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65200,
        "ntp_server": "ntp-us.example.com",
        "dns_server_primary": "208.67.222.222",
        "dns_server_secondary": "208.67.220.220",
        "contact": "noc-us@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.200.1/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.100.1/32",  "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "TenGigabitEthernet0/1/0","ip": "10.1.0.1/30",    "description": "Uplink to NYC-DC1-SW1", "vrf": ""},
        ],
    },
    "VT00006": {
        "service_id": "VT00006",
        "hostname": "rtr-sfo-edge-01.example.com",
        "short_name": "rtr-sfo-edge-01",
        "management_ip": "192.168.200.2",
        "loopback_ip": "10.255.100.2",
        "snmp_community_ro": "public_sfo_ro",
        "snmp_community_rw": "private_sfo_rw",
        "location": "San Francisco Colo",
        "site_code": "SFO-CO1",
        "country": "US",
        "vendor": "Juniper",
        "model": "MX204",
        "os": "JunOS",
        "os_version": "22.4R2",
        "role": "edge",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65201,
        "ntp_server": "ntp-us.example.com",
        "dns_server_primary": "208.67.222.222",
        "dns_server_secondary": "208.67.220.220",
        "contact": "noc-us@example.com",
        "interfaces": [
            {"name": "em0",  "ip": "192.168.200.2/24", "description": "Management", "vrf": "MGMT"},
            {"name": "lo0",  "ip": "10.255.100.2/32",  "description": "Loopback",   "vrf": ""},
            {"name": "xe-0/0/0", "ip": "10.1.1.1/30", "description": "Uplink to ISP-West", "vrf": ""},
        ],
    },
    "VT00007": {
        "service_id": "VT00007",
        "hostname": "rtr-sgp-core-01.example.com",
        "short_name": "rtr-sgp-core-01",
        "management_ip": "192.168.150.1",
        "loopback_ip": "10.255.50.1",
        "snmp_community_ro": "public_sgp_ro",
        "snmp_community_rw": "private_sgp_rw",
        "location": "Singapore Data Centre 1",
        "site_code": "SGP-DC1",
        "country": "SG",
        "vendor": "Cisco",
        "model": "ASR1001-HX",
        "os": "IOS-XE",
        "os_version": "17.9.4",
        "role": "core",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65300,
        "ntp_server": "ntp-ap.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "noc-ap@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.150.1/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.50.1/32",   "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "TenGigabitEthernet0/1/0","ip": "10.2.0.1/30",    "description": "Uplink to SGP-DC1-SW1", "vrf": ""},
        ],
    },
    "VT00008": {
        "service_id": "VT00008",
        "hostname": "rtr-syd-cpe-01.example.com",
        "short_name": "rtr-syd-cpe-01",
        "management_ip": "192.168.151.1",
        "loopback_ip": "10.255.51.1",
        "snmp_community_ro": "public_syd_ro",
        "snmp_community_rw": "private_syd_rw",
        "location": "Sydney Office",
        "site_code": "SYD-OF1",
        "country": "AU",
        "vendor": "Cisco",
        "model": "ISR1100-6G",
        "os": "IOS-XE",
        "os_version": "17.11.1a",
        "role": "cpe",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65301,
        "ntp_server": "ntp-ap.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "local-it@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0", "ip": "192.168.151.1/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",             "ip": "10.255.51.1/32",   "description": "Router-ID", "vrf": ""},
            {"name": "GigabitEthernet0/0/1",  "ip": "dhcp",            "description": "WAN", "vrf": ""},
            {"name": "GigabitEthernet0/0/2",  "ip": "10.10.100.1/24", "description": "LAN", "vrf": ""},
        ],
    },
    "VT00009": {
        "service_id": "VT00009",
        "hostname": "rtr-dub-dist-01.example.com",
        "short_name": "rtr-dub-dist-01",
        "management_ip": "192.168.100.10",
        "loopback_ip": "10.255.0.10",
        "snmp_community_ro": "public_dub_ro",
        "snmp_community_rw": "private_dub_rw",
        "location": "Dublin Data Centre",
        "site_code": "DUB-DC1",
        "country": "IE",
        "vendor": "Cisco",
        "model": "C8500-12X4QC",
        "os": "IOS-XE",
        "os_version": "17.12.1",
        "role": "distribution",
        "vrf_mgmt": "MGMT",
        "bgp_asn": 65004,
        "ntp_server": "ntp1.example.com",
        "dns_server_primary": "8.8.8.8",
        "dns_server_secondary": "8.8.4.4",
        "contact": "noc@example.com",
        "interfaces": [
            {"name": "GigabitEthernet0/0/0",   "ip": "192.168.100.10/24", "description": "Management", "vrf": "MGMT"},
            {"name": "Loopback0",               "ip": "10.255.0.10/32",   "description": "Router-ID / iBGP source", "vrf": ""},
            {"name": "TenGigabitEthernet0/1/0", "ip": "10.0.2.1/30",     "description": "Uplink to LON-DC1-CORE", "vrf": ""},
            {"name": "TenGigabitEthernet0/1/1", "ip": "10.0.2.5/30",     "description": "Uplink to AMS-DC2-CORE", "vrf": ""},
        ],
    },
}


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"status": "ok", "devices": len(DEVICES)}


@app.get("/devices")
def list_devices():
    """Return a summary list of all devices (no interfaces)."""
    summary_keys = [
        "service_id", "hostname", "management_ip", "site_code",
        "location", "country", "vendor", "model", "role",
    ]
    return [
        {k: v for k, v in device.items() if k in summary_keys}
        for device in DEVICES.values()
    ]


@app.get("/devices/{service_id}")
def get_device(service_id: str):
    """Return full device record including interfaces."""
    device = DEVICES.get(service_id.upper())
    if device is None:
        raise HTTPException(
            status_code=404,
            detail=f"Device '{service_id}' not found. "
                   f"Known IDs: {', '.join(sorted(DEVICES))}",
        )
    return device


@app.get("/devices/{service_id}/interfaces")
def get_device_interfaces(service_id: str):
    """Return only the interface list for a device."""
    device = DEVICES.get(service_id.upper())
    if device is None:
        raise HTTPException(status_code=404, detail=f"Device '{service_id}' not found.")
    return {"service_id": device["service_id"], "interfaces": device["interfaces"]}
