#!/usr/bin/env python3
"""
Seed script: create the Router Provisioning project in Templarc.

Usage:
    uv run python scripts/seed_router_provisioning.py [--base-url http://localhost:8000] [--token <jwt>]

If --token is not provided, the script will attempt to log in as admin using
the TEMPLARC_USERNAME / TEMPLARC_PASSWORD environment variables (defaults: admin/admin).

The script is IDEMPOTENT: it checks for existing objects before creating them and
skips anything that already exists.
"""

import argparse
import json
import os
import sys
import time
import httpx

# ---------------------------------------------------------------------------
# Hardware definitions extracted from the DEVICES/ folder of the legacy system
# ---------------------------------------------------------------------------

CISCO_HARDWARE = [
    "C891F",
    "C1111",
    "ASR1001-X",
    "C8300-1N1S-4T2X",
    "C8300-1N1S-6T",
    "C2921",
]

ONEACCESS_HARDWARE = [
    "LBB320",
    "LBB150",
    "LBB154",
    "LBB156",
    "LBB157",
    "LBB400",
    "LBB500",
    "LBB4G",
]

ALL_HARDWARE_OPTIONS = (
    [{"value": f"cisco.{h}", "label": f"Cisco {h}"} for h in CISCO_HARDWARE]
    + [{"value": f"oneaccess.{h}", "label": f"OneAccess {h}"} for h in ONEACCESS_HARDWARE]
)

# ---------------------------------------------------------------------------
# Template catalog definition
# ---------------------------------------------------------------------------

TEMPLATES = [
    # ── L3VPN ──────────────────────────────────────────────────────────────
    {
        "key": "l3vpn",
        "name": "l3vpn",
        "display_name": "L3VPN (IP-VPN)",
        "description": "Parent template for all L3VPN (IP-VPN) service types",
        "git_path": None,  # parent-only, no content file
        "parent_key": None,
        "sort_order": 10,
    },
    {
        "key": "l3vpn_direct_fiber_mpa",
        "name": "l3vpn_direct_fiber_mpa",
        "display_name": "L3VPN - Direct Fiber MPA",
        "description": "IPVPN over Direct Fiber with MPA (802.1Q tagged WAN)",
        "git_path": "router_provisioning/l3vpn_direct_fiber_mpa.j2",
        "parent_key": "l3vpn",
        "sort_order": 10,
    },
    {
        "key": "l3vpn_4g",
        "name": "l3vpn_4g",
        "display_name": "L3VPN - 4G",
        "description": "IPVPN over 4G cellular WAN",
        "git_path": "router_provisioning/l3vpn_4g.j2",
        "parent_key": "l3vpn",
        "sort_order": 20,
    },
    {
        "key": "l3vpn_ext_eth",
        "name": "l3vpn_ext_eth",
        "display_name": "L3VPN - Ext Eth / Fiber Eth",
        "description": "IPVPN over External Ethernet / Fiber Ethernet",
        "git_path": "router_provisioning/l3vpn_ext_eth.j2",
        "parent_key": "l3vpn",
        "sort_order": 30,
    },
    {
        "key": "l3vpn_vdsl_dedicated",
        "name": "l3vpn_vdsl_dedicated",
        "display_name": "L3VPN - VDSL Dedicated",
        "description": "IPVPN over VDSL2 with dedicated VLAN",
        "git_path": "router_provisioning/l3vpn_vdsl_dedicated.j2",
        "parent_key": "l3vpn",
        "sort_order": 40,
    },
    {
        "key": "l3vpn_vdsl_shared",
        "name": "l3vpn_vdsl_shared",
        "display_name": "L3VPN - VDSL Shared",
        "description": "IPVPN over VDSL2 with shared VLAN",
        "git_path": "router_provisioning/l3vpn_vdsl_shared.j2",
        "parent_key": "l3vpn",
        "sort_order": 50,
    },
    {
        "key": "l3vpn_dmvpn",
        "name": "l3vpn_dmvpn",
        "display_name": "L3VPN - DMVPN",
        "description": "IPVPN over DMVPN (GRE over IPSec)",
        "git_path": "router_provisioning/l3vpn_dmvpn.j2",
        "parent_key": "l3vpn",
        "sort_order": 60,
    },
    # ── Corporate Internet ─────────────────────────────────────────────────
    {
        "key": "ci",
        "name": "corporate_internet",
        "display_name": "Corporate Internet",
        "description": "Parent template for all Corporate Internet service types",
        "git_path": None,
        "parent_key": None,
        "sort_order": 20,
    },
    {
        "key": "ci_direct_fiber_mpa",
        "name": "ci_direct_fiber_mpa",
        "display_name": "CI - Direct Fiber MPA",
        "description": "Corporate Internet over Direct Fiber with MPA",
        "git_path": "router_provisioning/corporate_internet_direct_fiber_mpa.j2",
        "parent_key": "ci",
        "sort_order": 10,
    },
    {
        "key": "ci_4g",
        "name": "ci_4g",
        "display_name": "CI - 4G",
        "description": "Corporate Internet over 4G cellular WAN",
        "git_path": "router_provisioning/corporate_internet_4g.j2",
        "parent_key": "ci",
        "sort_order": 20,
    },
    {
        "key": "ci_ext_eth",
        "name": "ci_ext_eth",
        "display_name": "CI - Ext Eth / Fiber Eth",
        "description": "Corporate Internet over External Ethernet / Fiber Ethernet",
        "git_path": "router_provisioning/corporate_internet_ext_eth.j2",
        "parent_key": "ci",
        "sort_order": 30,
    },
    {
        "key": "ci_vdsl_dedicated",
        "name": "ci_vdsl_dedicated",
        "display_name": "CI - VDSL Dedicated",
        "description": "Corporate Internet over VDSL2 with dedicated VLAN",
        "git_path": "router_provisioning/corporate_internet_vdsl_dedicated.j2",
        "parent_key": "ci",
        "sort_order": 40,
    },
    {
        "key": "ci_vdsl_shared",
        "name": "ci_vdsl_shared",
        "display_name": "CI - VDSL Shared",
        "description": "Corporate Internet over VDSL2 with shared VLAN",
        "git_path": "router_provisioning/corporate_internet_vdsl_shared.j2",
        "parent_key": "ci",
        "sort_order": 50,
    },
    # ── Emergency 4G ───────────────────────────────────────────────────────
    {
        "key": "emergency_4g",
        "name": "emergency_4g",
        "display_name": "Emergency 4G",
        "description": "Emergency 4G LBB standalone configuration",
        "git_path": "router_provisioning/emergency_4g.j2",
        "parent_key": None,
        "sort_order": 30,
    },
]

# ---------------------------------------------------------------------------
# Project-level (proj.*) parameters
# ---------------------------------------------------------------------------

PROJ_PARAMETERS = [
    {
        "name": "proj.ntp_server",
        "label": "NTP Server",
        "description": "Primary NTP server IP or hostname (comma-separated for multiple)",
        "widget_type": "text",
        "required": False,
        "sort_order": 10,
        "section": "Infrastructure",
    },
    {
        "name": "proj.dns_server",
        "label": "DNS Server",
        "description": "Primary DNS server IP (comma-separated for multiple)",
        "widget_type": "text",
        "required": False,
        "sort_order": 20,
        "section": "Infrastructure",
    },
    {
        "name": "proj.snmp_community",
        "label": "SNMP Community",
        "description": "SNMP read-only community string",
        "widget_type": "hidden",
        "required": False,
        "sort_order": 30,
        "section": "Infrastructure",
    },
    {
        "name": "proj.as_number",
        "label": "AS Number",
        "description": "BGP Autonomous System number for this project",
        "widget_type": "text",
        "required": False,
        "sort_order": 40,
        "section": "Infrastructure",
    },
    {
        "name": "proj.syslog_server",
        "label": "Syslog Server",
        "description": "Syslog collector IP or hostname",
        "widget_type": "text",
        "required": False,
        "sort_order": 50,
        "section": "Infrastructure",
    },
    {
        "name": "proj.tacacs_servers",
        "label": "TACACS+ Servers",
        "description": "Comma-separated list of TACACS+ server IPs",
        "widget_type": "text",
        "required": False,
        "sort_order": 60,
        "section": "AAA",
    },
    {
        "name": "proj.tacacs_key",
        "label": "TACACS+ Key",
        "description": "TACACS+ shared secret key",
        "widget_type": "hidden",
        "required": False,
        "sort_order": 70,
        "section": "AAA",
    },
    {
        "name": "proj.tacacs_group",
        "label": "TACACS+ Group Name",
        "description": "AAA server group name for TACACS+",
        "widget_type": "text",
        "required": False,
        "default_value": "TACACS_GROUP",
        "sort_order": 80,
        "section": "AAA",
    },
]

# ---------------------------------------------------------------------------
# Template-local parameters per template key
# These are attached to the leaf templates (not parent-only templates).
# ---------------------------------------------------------------------------

# Common parameters shared by all CPE templates
COMMON_PARAMS = [
    {
        "name": "hostname",
        "label": "CPE Hostname",
        "description": "FQDN or short hostname of the router",
        "help_text": "Lowercase, alphanumeric and hyphens only. Example: customer01-02str-01",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^[a-z0-9\-_]+$",
        "sort_order": 10,
        "section": "General",
    },
    {
        "name": "service_id",
        "label": "Service ID (VT)",
        "description": "VT reference number",
        "help_text": "Format: VT followed by 5-6 digits. Example: VT12345",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^VT[0-9]{5,6}$",
        "sort_order": 20,
        "section": "General",
    },
    {
        "name": "gsid",
        "label": "GSID Reference",
        "description": "GSID change/order reference",
        "help_text": "Format: GS followed by digits. Example: GS201702091233",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^GS[0-9]+$",
        "sort_order": 30,
        "section": "General",
    },
    {
        "name": "loopback_ip",
        "label": "Loopback IP",
        "description": "Management loopback IP address (host /32)",
        "help_text": "CIDR notation /32. Example: 94.105.13.7/32",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/32$",
        "sort_order": 40,
        "section": "General",
    },
    {
        "name": "router_function",
        "label": "Router Function",
        "description": "Defines BGP route-maps, VRRP, and tracking configuration",
        "widget_type": "select",
        "required": True,
        "default_value": "STANDALONE",
        "sort_order": 50,
        "section": "General",
        "options": [
            {"value": "STANDALONE", "label": "Standalone (single WAN, no backup)"},
            {"value": "PRIMARY", "label": "Primary (single WAN, backup exists)"},
            {"value": "BACKUP", "label": "Backup (single WAN, primary exists)"},
            {"value": "MIXED", "label": "Mixed (multiple WAN links)"},
        ],
    },
    {
        "name": "hardware",
        "label": "Hardware Model",
        "description": "CPE hardware model — determines vendor-specific config snippets",
        "widget_type": "select",
        "required": True,
        "sort_order": 60,
        "section": "Hardware",
        "options": ALL_HARDWARE_OPTIONS,
    },
    {
        "name": "vendor",
        "label": "Vendor",
        "description": "CPE vendor (auto-filled from hardware selection)",
        "widget_type": "readonly",
        "required": False,
        "sort_order": 61,
        "section": "Hardware",
        "is_derived": True,
        "derived_expression": "CISCO if HARDWARE.startswith('cisco.') else ONEACCESS",
    },
]

# Parameters specific to Direct Fiber MPA templates
DIRECT_FIBER_PARAMS = [
    {
        "name": "pe_hostname",
        "label": "PE Hostname",
        "description": "Provider Edge router hostname",
        "help_text": "Example: NOS-VAR-01",
        "widget_type": "text",
        "required": True,
        "sort_order": 100,
        "section": "WAN",
    },
    {
        "name": "pe_interface",
        "label": "PE Interface",
        "description": "PE-facing interface name",
        "help_text": "Example: GigabitEthernet 3/0/9.242",
        "widget_type": "text",
        "required": True,
        "sort_order": 110,
        "section": "WAN",
    },
    {
        "name": "wan_p2p_network",
        "label": "WAN P2P Subnet",
        "description": "WAN point-to-point /30 subnet",
        "help_text": "CIDR /30. Example: 94.107.32.4/30",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/30$",
        "sort_order": 120,
        "section": "WAN",
    },
    {
        "name": "wan_vlanid_mpa",
        "label": "WAN VLAN ID",
        "description": "802.1Q VLAN tag for WAN subinterface",
        "widget_type": "select",
        "required": True,
        "default_value": "300",
        "sort_order": 130,
        "section": "WAN",
        "options": [
            {"value": "100", "label": "100 - VoIP"},
            {"value": "200", "label": "200 - Internet"},
            {"value": "300", "label": "300 - IPVPN Data"},
            {"value": "400", "label": "400 - Partners"},
        ],
    },
    {
        "name": "bw_down_mb",
        "label": "Download Bandwidth (MB)",
        "description": "Committed download bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 140,
        "section": "QoS",
    },
    {
        "name": "bw_up_mb",
        "label": "Upload Bandwidth (MB)",
        "description": "Committed upload bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 150,
        "section": "QoS",
    },
    {
        "name": "vrf",
        "label": "VRF Name",
        "description": "Customer VRF name (L3VPN only)",
        "widget_type": "text",
        "required": True,
        "sort_order": 160,
        "section": "Routing",
    },
    {
        "name": "bgp_private_as",
        "label": "BGP Private AS",
        "description": "Customer BGP AS number (leave blank to use project default)",
        "widget_type": "text",
        "required": False,
        "sort_order": 170,
        "section": "Routing",
    },
    {
        "name": "cpe_dynamic_routing",
        "label": "Enable BGP",
        "description": "Enable dynamic BGP routing",
        "widget_type": "select",
        "required": False,
        "default_value": "true",
        "sort_order": 180,
        "section": "Routing",
        "options": [
            {"value": "true", "label": "Yes — enable BGP"},
            {"value": "false", "label": "No — static routing only"},
        ],
    },
]

# Parameters specific to 4G templates
PARAMS_4G = [
    {
        "name": "mobile_data_ip",
        "label": "Mobile Data IP",
        "description": "Static 4G mobile data IP address",
        "help_text": "CIDR /32. Example: 94.107.128.10/32",
        "widget_type": "text",
        "required": True,
        "sort_order": 100,
        "section": "WAN",
    },
    {
        "name": "cellular_apn",
        "label": "4G APN",
        "description": "4G APN name",
        "help_text": "Example: FIXB2B4G.BE",
        "widget_type": "text",
        "required": True,
        "sort_order": 110,
        "section": "WAN",
    },
    {
        "name": "cellular_sim_card",
        "label": "SIM Card Number",
        "description": "SIM card ICCID",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^[0-9]+$",
        "sort_order": 120,
        "section": "WAN",
    },
    {
        "name": "cellular_pin_code",
        "label": "SIM PIN Code",
        "description": "SIM card PIN (3-4 digits)",
        "widget_type": "hidden",
        "required": True,
        "validation_regex": r"^[0-9]{3,4}$",
        "sort_order": 130,
        "section": "WAN",
    },
    {
        "name": "cellular_puk_code",
        "label": "SIM PUK Code",
        "description": "SIM card PUK unlock code",
        "widget_type": "hidden",
        "required": False,
        "validation_regex": r"^[0-9]+$",
        "sort_order": 140,
        "section": "WAN",
    },
    {
        "name": "bgp_4g_cpe_ip",
        "label": "CPE BGP Neighbor IP (4G)",
        "description": "CPE BGP neighbor IP for 4G IPSec tunnel (last octet of 192.4.2.x)",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^[0-9]{1,3}$",
        "sort_order": 150,
        "section": "Routing",
    },
    {
        "name": "bw_down_mb",
        "label": "Download Bandwidth (MB)",
        "description": "Committed download bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 160,
        "section": "QoS",
    },
    {
        "name": "bw_up_mb",
        "label": "Upload Bandwidth (MB)",
        "description": "Committed upload bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 170,
        "section": "QoS",
    },
    {
        "name": "vrf",
        "label": "VRF Name",
        "description": "Customer VRF name (L3VPN only)",
        "widget_type": "text",
        "required": True,
        "sort_order": 180,
        "section": "Routing",
    },
    {
        "name": "cpe_dynamic_routing",
        "label": "Enable BGP",
        "description": "Enable dynamic BGP routing",
        "widget_type": "select",
        "required": False,
        "default_value": "true",
        "sort_order": 190,
        "section": "Routing",
        "options": [
            {"value": "true", "label": "Yes — enable BGP"},
            {"value": "false", "label": "No — static routing only"},
        ],
    },
]

# Parameters for VDSL dedicated
PARAMS_VDSL_DEDICATED = [
    {
        "name": "wan_vdsl2_vlanid",
        "label": "VDSL2 VLAN ID",
        "description": "VDSL2 dedicated VLAN identifier",
        "widget_type": "select",
        "required": True,
        "default_value": "300",
        "sort_order": 100,
        "section": "WAN",
        "options": [
            {"value": "100", "label": "100 - VoIP"},
            {"value": "200", "label": "200 - Internet"},
            {"value": "300", "label": "300 - IPVPN Data"},
            {"value": "400", "label": "400 - Partners"},
        ],
    },
    {
        "name": "wan_p2p_network",
        "label": "WAN P2P Subnet",
        "description": "WAN point-to-point /30 subnet",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/30$",
        "sort_order": 110,
        "section": "WAN",
    },
    {
        "name": "bw_down_mb",
        "label": "Download Bandwidth (MB)",
        "description": "Committed download bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 120,
        "section": "QoS",
    },
    {
        "name": "bw_up_mb",
        "label": "Upload Bandwidth (MB)",
        "description": "Committed upload bandwidth in Megabits/s",
        "widget_type": "number",
        "required": True,
        "sort_order": 130,
        "section": "QoS",
    },
    {
        "name": "vrf",
        "label": "VRF Name",
        "description": "Customer VRF name (L3VPN only)",
        "widget_type": "text",
        "required": False,
        "sort_order": 140,
        "section": "Routing",
    },
    {
        "name": "cpe_dynamic_routing",
        "label": "Enable BGP",
        "description": "Enable dynamic BGP routing",
        "widget_type": "select",
        "required": False,
        "default_value": "true",
        "sort_order": 150,
        "section": "Routing",
        "options": [
            {"value": "true", "label": "Yes — enable BGP"},
            {"value": "false", "label": "No — static routing only"},
        ],
    },
]

# Parameters for DMVPN
PARAMS_DMVPN = [
    {
        "name": "pe_tunnel_id",
        "label": "PE DMVPN Tunnel ID",
        "description": "PE-side DMVPN tunnel number (range 25000-25099)",
        "help_text": "Example: 25010",
        "widget_type": "text",
        "required": True,
        "validation_regex": r"^250\d{2}$",
        "sort_order": 100,
        "section": "DMVPN",
    },
    {
        "name": "dmvpn_cpe_ip_index",
        "label": "DMVPN CPE IP Index",
        "description": "Last octet of CPE tunnel IP (192.4.0.x)",
        "help_text": "A number 1-253",
        "widget_type": "number",
        "required": True,
        "default_value": "1",
        "sort_order": 110,
        "section": "DMVPN",
    },
    {
        "name": "dmvpn_loopback_ant",
        "label": "DMVPN Tunnel Dest - ANT Loopback",
        "description": "Loopback IP of the ANT hub router",
        "widget_type": "text",
        "required": True,
        "sort_order": 120,
        "section": "DMVPN",
    },
    {
        "name": "dmvpn_loopback_nos",
        "label": "DMVPN Tunnel Dest - NOS Loopback",
        "description": "Loopback IP of the NOS hub router",
        "widget_type": "text",
        "required": True,
        "sort_order": 130,
        "section": "DMVPN",
    },
    {
        "name": "wan_p2p_network",
        "label": "WAN P2P Subnet",
        "description": "Underlay WAN point-to-point /30 subnet",
        "widget_type": "text",
        "required": True,
        "sort_order": 140,
        "section": "WAN",
    },
    {
        "name": "bw_down_mb",
        "label": "Download Bandwidth (MB)",
        "widget_type": "number",
        "required": True,
        "sort_order": 150,
        "section": "QoS",
    },
    {
        "name": "bw_up_mb",
        "label": "Upload Bandwidth (MB)",
        "widget_type": "number",
        "required": True,
        "sort_order": 160,
        "section": "QoS",
    },
]

# Emergency 4G specific (uses PARAMS_4G without VRF)
PARAMS_EMERGENCY_4G = [p for p in PARAMS_4G if p["name"] != "vrf"]

# Mapping: template key → template-local parameters to create
TEMPLATE_PARAMS = {
    "l3vpn_direct_fiber_mpa": COMMON_PARAMS + DIRECT_FIBER_PARAMS,
    "l3vpn_4g": COMMON_PARAMS + PARAMS_4G,
    "l3vpn_ext_eth": COMMON_PARAMS + [
        {**p} for p in DIRECT_FIBER_PARAMS if p["name"] != "wan_vlanid_mpa"
    ],
    "l3vpn_vdsl_dedicated": COMMON_PARAMS + PARAMS_VDSL_DEDICATED,
    "l3vpn_vdsl_shared": COMMON_PARAMS + [
        p for p in PARAMS_VDSL_DEDICATED if p["name"] != "wan_vdsl2_vlanid"
    ],
    "l3vpn_dmvpn": COMMON_PARAMS + PARAMS_DMVPN,
    "ci_direct_fiber_mpa": COMMON_PARAMS + [
        {**p, **{"name": p["name"]}} for p in DIRECT_FIBER_PARAMS if p["name"] != "vrf"
    ],
    "ci_4g": COMMON_PARAMS + [p for p in PARAMS_4G if p["name"] not in ("vrf",)],
    "ci_ext_eth": COMMON_PARAMS + [
        p for p in DIRECT_FIBER_PARAMS if p["name"] not in ("wan_vlanid_mpa", "vrf")
    ],
    "ci_vdsl_dedicated": COMMON_PARAMS + [
        p for p in PARAMS_VDSL_DEDICATED if p["name"] != "vrf"
    ],
    "ci_vdsl_shared": COMMON_PARAMS + [
        p for p in PARAMS_VDSL_DEDICATED if p["name"] not in ("wan_vdsl2_vlanid", "vrf")
    ],
    "emergency_4g": COMMON_PARAMS + PARAMS_EMERGENCY_4G,
}

# ---------------------------------------------------------------------------
# Sample test data to import as presets
# ---------------------------------------------------------------------------

PRESETS = {
    "l3vpn_direct_fiber_mpa": [
        {
            "name": "Test - C891F Cisco",
            "description": "Sample L3VPN Direct Fiber MPA with Cisco C891F",
            "params": {
                "hostname": "test01-02str-99",
                "service_id": "VT991234",
                "gsid": "GS2017051212349",
                "loopback_ip": "94.107.1.1/32",
                "router_function": "STANDALONE",
                "hardware": "cisco.C891F",
                "vendor": "CISCO",
                "pe_hostname": "NOS-VAR-04",
                "pe_interface": "GigabitEthernet3/0/6",
                "wan_p2p_network": "94.105.20.4/30",
                "wan_vlanid_mpa": "300",
                "bw_down_mb": "20",
                "bw_up_mb": "5",
                "vrf": "MYVRF_0001",
                "cpe_dynamic_routing": "true",
            },
        },
        {
            "name": "Test - LBB320 OneAccess",
            "description": "Sample L3VPN Direct Fiber MPA with OneAccess LBB320",
            "params": {
                "hostname": "test02-02str-01",
                "service_id": "VT991235",
                "gsid": "GS2017051212350",
                "loopback_ip": "94.107.1.2/32",
                "router_function": "STANDALONE",
                "hardware": "oneaccess.LBB320",
                "vendor": "ONEACCESS",
                "pe_hostname": "NOS-VAR-01",
                "pe_interface": "GigabitEthernet3/0/9",
                "wan_p2p_network": "94.107.32.4/30",
                "wan_vlanid_mpa": "300",
                "bw_down_mb": "100",
                "bw_up_mb": "100",
                "vrf": "MYVRF_0002",
                "cpe_dynamic_routing": "true",
            },
        },
    ],
    "l3vpn_4g": [
        {
            "name": "Test - LBB4G OneAccess",
            "description": "Sample L3VPN 4G with OneAccess LBB4G",
            "params": {
                "hostname": "test03-4g-01",
                "service_id": "VT991236",
                "gsid": "GS2017051212351",
                "loopback_ip": "94.107.128.10/32",
                "router_function": "STANDALONE",
                "hardware": "oneaccess.LBB4G",
                "vendor": "ONEACCESS",
                "mobile_data_ip": "94.107.128.10/32",
                "cellular_apn": "FIXB2B4G.BE",
                "cellular_sim_card": "7633332704304",
                "cellular_pin_code": "1234",
                "bgp_4g_cpe_ip": "10",
                "bw_down_mb": "10",
                "bw_up_mb": "5",
                "vrf": "MYVRF_0003",
                "cpe_dynamic_routing": "true",
            },
        }
    ],
    "emergency_4g": [
        {
            "name": "Test - LBB4G Emergency",
            "description": "Sample Emergency 4G with OneAccess LBB4G",
            "params": {
                "hostname": "emergency-site-01",
                "service_id": "VT991240",
                "gsid": "GS2017051212355",
                "loopback_ip": "94.107.128.20/32",
                "router_function": "STANDALONE",
                "hardware": "oneaccess.LBB4G",
                "vendor": "ONEACCESS",
                "mobile_data_ip": "94.107.128.20/32",
                "cellular_apn": "FIXB2B4G.BE",
                "cellular_sim_card": "7633332704310",
                "cellular_pin_code": "1234",
                "cellular_puk_code": "12345678",
                "bgp_4g_cpe_ip": "20",
                "bw_down_mb": "10",
                "bw_up_mb": "5",
                "cpe_dynamic_routing": "false",
            },
        }
    ],
}


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

class Client:
    def __init__(self, base_url: str, token: str):
        self.http = httpx.Client(base_url=base_url, timeout=30.0)
        self.http.headers["Authorization"] = f"Bearer {token}"
        self.http.headers["Content-Type"] = "application/json"

    def get(self, path: str, **kwargs):
        r = self.http.get(path, **kwargs)
        r.raise_for_status()
        return r.json()

    def _request(self, method: str, path: str, **kwargs):
        """Execute request with retry on 429 rate limit."""
        for attempt in range(5):
            r = getattr(self.http, method)(path, **kwargs)
            if r.status_code == 429:
                wait = 65
                print(f"  ⏱ Rate limited — waiting {wait}s before retry ({attempt+1}/5)...")
                time.sleep(wait)
                continue
            return r
        return r  # return last response after max retries

    def post(self, path: str, data: dict):
        r = self._request("post", path, content=json.dumps(data))
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
        return r.json()

    def put(self, path: str, data: dict):
        r = self._request("put", path, content=json.dumps(data))
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
        return r.json()

    def delete(self, path: str):
        r = self.http.delete(path)
        if r.status_code not in (200, 204):
            r.raise_for_status()


def get_token(base_url: str, username: str, password: str) -> str:
    # Try LDAP/main login first, fall back to local-only login
    for endpoint in ["/auth/login", "/auth/login/local"]:
        r = httpx.post(
            f"{base_url}{endpoint}",
            json={"username": username, "password": password},
            timeout=10,
        )
        if r.status_code == 200:
            return r.json()["access_token"]
        if r.status_code == 403 and "Local login is disabled" in r.text:
            continue  # try next endpoint
        print(f"Login failed at {endpoint}: {r.status_code} {r.text}")
        sys.exit(1)
    print("All login endpoints failed")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

def find_project(client: Client, name: str) -> dict | None:
    try:
        projects = client.get("/catalog/projects")
        items = projects.get("items", projects) if isinstance(projects, dict) else projects
        for p in items:
            if p["name"] == name:
                return p
    except Exception:
        pass
    return None


def find_template(client: Client, project_id: int, name: str) -> dict | None:
    try:
        resp = client.get(f"/catalog/projects/{project_id}/templates")
        items = resp if isinstance(resp, list) else resp.get("items", [])
        for t in items:
            if t["name"] == name:
                return t
        # also check /templates with project filter
        resp2 = client.get("/templates", params={"project_id": project_id})
        items2 = resp2.get("items", resp2) if isinstance(resp2, dict) else resp2
        for t in items2:
            if t["name"] == name:
                return t
    except Exception:
        pass
    return None


def find_parameter(client: Client, scope: str, owner_id: int, name: str) -> dict | None:
    """Find a parameter by name + scope + owner."""
    try:
        base_params = {
            "global": {},
            "project": {"project_id": owner_id},
            "template": {"template_id": owner_id},
        }
        query = {**base_params.get(scope, {}), "page_size": 200}
        resp = client.get("/parameters", params=query)
        items = resp.get("items", resp) if isinstance(resp, dict) else resp
        for p in items:
            if p["name"] == name and p["scope"] == scope:
                if scope == "project" and p.get("project_id") == owner_id:
                    return p
                elif scope == "template" and p.get("template_id") == owner_id:
                    return p
    except Exception:
        pass
    return None


def create_parameter(client: Client, scope: str, owner_id: int, param: dict) -> dict:
    payload = {
        "name": param["name"],
        "scope": scope,
        "widget_type": param.get("widget_type", "text"),
        "label": param.get("label"),
        "description": param.get("description"),
        "help_text": param.get("help_text"),
        "default_value": param.get("default_value"),
        "required": param.get("required", False),
        "validation_regex": param.get("validation_regex"),
        "is_derived": param.get("is_derived", False),
        "derived_expression": param.get("derived_expression"),
        "sort_order": param.get("sort_order", 0),
        "section": param.get("section"),
        "visible_when": param.get("visible_when"),
    }
    if scope == "project":
        payload["project_id"] = owner_id
    elif scope == "template":
        payload["template_id"] = owner_id

    # Remove None values
    payload = {k: v for k, v in payload.items() if v is not None}

    result = client.post("/parameters", payload)
    time.sleep(0.7)  # stay well under the 100/min rate limit

    # Add options if any
    options = param.get("options", [])
    for i, opt in enumerate(options):
        opt_payload = {
            "value": opt["value"],
            "label": opt["label"],
            "sort_order": opt.get("sort_order", i),
        }
        client.post(f"/parameters/{result['id']}/options", opt_payload)
        time.sleep(0.7)

    return result


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------

def seed(client: Client, org_id: int, dry_run: bool = False):
    print("\n── Step 1: Create or find 'Router Provisioning' project ──────────────")
    project = find_project(client, "router_provisioning")
    if project:
        print(f"  ✓ Project already exists (id={project['id']})")
    else:
        if not dry_run:
            project = client.post("/catalog/projects", {
                "organization_id": org_id,
                "name": "router_provisioning",
                "display_name": "Router Provisioning",
                "description": (
                    "CPE router configuration templates "
                    "(L3VPN, Corporate Internet, Emergency 4G)"
                ),
                "git_path": "router_provisioning",
                "output_comment_style": "!",
            })
            print(f"  ✓ Created project id={project['id']}")
        else:
            print("  [dry-run] Would create project 'router_provisioning'")
            return

    proj_id = project["id"]

    print("\n── Step 2: Create proj.* parameters ──────────────────────────────────")
    for param in PROJ_PARAMETERS:
        existing = find_parameter(client, "project", proj_id, param["name"])
        if existing:
            print(f"  ✓ Parameter '{param['name']}' already exists")
            continue
        if not dry_run:
            result = create_parameter(client, "project", proj_id, param)
            print(f"  ✓ Created proj param '{param['name']}' id={result['id']}")
        else:
            print(f"  [dry-run] Would create proj param '{param['name']}'")

    print("\n── Step 3: Create template catalog ───────────────────────────────────")
    template_ids: dict[str, int] = {}

    for tdef in TEMPLATES:
        existing = find_template(client, proj_id, tdef["name"])
        if existing:
            print(f"  ✓ Template '{tdef['name']}' already exists (id={existing['id']})")
            template_ids[tdef["key"]] = existing["id"]
            # Still upload content if file exists and template needs it
            if tdef.get("git_path") and not dry_run:
                git_path = os.path.join(
                    os.path.dirname(os.path.dirname(__file__)),
                    "templates_repo",
                    tdef["git_path"],
                )
                if os.path.isfile(git_path):
                    with open(git_path) as f:
                        file_content = f.read()
                    try:
                        client.put(f"/templates/{existing['id']}", {
                            "content": file_content,
                            "commit_message": f"Seed {tdef['name']} template content",
                            "author": "seed_router_provisioning.py",
                        })
                        print(f"    ✓ Uploaded/refreshed content for '{tdef['name']}'")
                    except Exception as e:
                        print(f"    ⚠ Could not upload content: {e}")
            continue

        if dry_run:
            print(f"  [dry-run] Would create template '{tdef['name']}'")
            continue

        parent_id = template_ids.get(tdef["parent_key"]) if tdef["parent_key"] else None
        payload = {
            "project_id": proj_id,
            "name": tdef["name"],
            "display_name": tdef["display_name"],
            "description": tdef["description"],
            "sort_order": tdef["sort_order"],
        }
        if parent_id:
            payload["parent_template_id"] = parent_id

        result = client.post("/templates", payload)
        template_ids[tdef["key"]] = result["id"]
        print(f"  ✓ Created template '{tdef['name']}' id={result['id']}")

        # Upload git content if available
        if tdef.get("git_path"):
            git_path = os.path.join(
                os.path.dirname(os.path.dirname(__file__)),
                "templates_repo",
                tdef["git_path"],
            )
            if os.path.isfile(git_path):
                with open(git_path) as f:
                    file_content = f.read()
                try:
                    client.put(f"/templates/{result['id']}", {
                        "content": file_content,
                        "commit_message": f"Add {tdef['name']} template (Phase 7 migration)",
                        "author": "seed_router_provisioning.py",
                    })
                    print(f"    ✓ Uploaded content from {tdef['git_path']}")
                except Exception as e:
                    print(f"    ⚠ Could not upload content: {e}")

    print("\n── Step 4: Create template-local parameters ──────────────────────────")
    for tkey, params in TEMPLATE_PARAMS.items():
        tmpl_id = template_ids.get(tkey)
        if not tmpl_id:
            print(f"  ⚠ Template '{tkey}' not found, skipping its parameters")
            continue

        print(f"  Template: {tkey} (id={tmpl_id})")
        for param in params:
            existing = find_parameter(client, "template", tmpl_id, param["name"])
            if existing:
                print(f"    ✓ '{param['name']}' already exists")
                continue
            if not dry_run:
                result = create_parameter(client, "template", tmpl_id, param)
                print(f"    ✓ Created '{param['name']}' id={result['id']}")
            else:
                print(f"    [dry-run] Would create '{param['name']}'")

    print("\n── Step 5: Import TESTDATA as presets ────────────────────────────────")
    for tkey, preset_list in PRESETS.items():
        tmpl_id = template_ids.get(tkey)
        if not tmpl_id:
            print(f"  ⚠ Template '{tkey}' not found, skipping presets")
            continue

        # Check existing presets
        try:
            existing_presets = client.get(f"/templates/{tmpl_id}/presets")
            existing_names = {p["name"] for p in existing_presets}
        except Exception:
            existing_names = set()

        for preset in preset_list:
            if preset["name"] in existing_names:
                print(f"  ✓ Preset '{preset['name']}' already exists")
                continue
            if not dry_run:
                result = client.post(f"/templates/{tmpl_id}/presets", preset)
                print(f"  ✓ Created preset '{preset['name']}' id={result['id']}")
            else:
                print(f"  [dry-run] Would create preset '{preset['name']}'")

    print("\n── Seed complete ─────────────────────────────────────────────────────")
    print(f"  Project: Router Provisioning (id={proj_id})")
    print(f"  Templates created: {len(template_ids)}")
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Seed Router Provisioning project in Templarc")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="JWT bearer token (overrides login)")
    parser.add_argument("--org-id", type=int, default=1, help="Organization ID")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without executing")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    if args.token:
        token = args.token
    else:
        username = os.environ.get("TEMPLARC_USERNAME", "admin")
        password = os.environ.get("TEMPLARC_PASSWORD", "admin")
        print(f"Logging in as {username} at {base_url}...")
        token = get_token(base_url, username, password)
        print("  ✓ Authenticated")

    client = Client(base_url, token)
    seed(client, args.org_id, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
