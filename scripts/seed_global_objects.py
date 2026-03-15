#!/usr/bin/env python3
"""
Seed script: register global-scope custom objects (net, router) in Templarc.

Usage:
    uv run python scripts/seed_global_objects.py [--base-url http://localhost:8000] [--token <jwt>]

If --token is not provided, the script will attempt to log in as admin using
the TEMPLARC_USERNAME / TEMPLARC_PASSWORD environment variables (defaults: admin/admin).

The script is IDEMPOTENT: it skips objects that already exist by name.
"""

import argparse
import json
import os
import sys
import time
import httpx

# ---------------------------------------------------------------------------
# Global custom object definitions
# ---------------------------------------------------------------------------

NET_CODE = '''\
class net:
    VLANS = {
        'management': 99,
        'voice':      10,
        'data':       20,
        'guest':      30,
        'iot':        40,
        'wan':        100,
        'dmz':        50,
    }

    MTU = {
        'ethernet':  1500,
        'mpls':      1508,
        'gre':       1476,
        'ipsec':     1400,
        'pppoe':     1492,
        'jumbo':     9000,
        'vxlan':     1450,
    }

    QOS = {
        'profiles': {
            'standard':    'WAN-QOS-STD',
            'premium':     'WAN-QOS-PREMIUM',
            'voice':       'WAN-QOS-VOICE',
            'best_effort': 'WAN-QOS-BE',
        },
        'dscp': {
            'ef':   46,
            'cs5':  40,
            'af41': 34,
            'af31': 26,
            'af21': 18,
            'af11': 10,
            'cs0':   0,
        },
        'queues': {
            'voice':        {'dscp': 'ef',   'bandwidth_pct': 20, 'priority': True},
            'interactive':  {'dscp': 'af41', 'bandwidth_pct': 30, 'priority': False},
            'business':     {'dscp': 'af31', 'bandwidth_pct': 30, 'priority': False},
            'best_effort':  {'dscp': 'cs0',  'bandwidth_pct': 20, 'priority': False},
        },
    }

    BGP = {
        'communities': {
            'default_route': '65000:1',
            'no_export':     '65000:100',
            'blackhole':     '65000:666',
            'backup_only':   '65000:200',
        },
        'timers': {
            'keepalive': 10,
            'hold':      30,
        },
    }

    ROUTING = {
        'admin_distance': {
            'static':     1,
            'ospf':     110,
            'bgp_ebgp':  20,
            'bgp_ibgp': 200,
        },
        'ospf_area': 0,
        'bgp_asn':   65000,
    }

    ACLS = {
        'mgmt_sources':  ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
        'ntp_servers':   ['10.1.1.1', '10.1.1.2'],
        'syslog_server': '10.1.2.100',
        'snmp_hosts':    ['10.1.3.1', '10.1.3.2'],
        'tacacs_server': '10.1.4.1',
    }
'''

ROUTER_CODE = '''\
class router:
    CPE_MODELS = {
        'cisco.c891f': {
            'vendor': 'CISCO', 'os': 'IOS',
            'wan_interface': 'GigabitEthernet8',
            'lan_vlan_interface': 'Vlan',
            'loopback_interface': 'Loopback',
            'ppp_interface': 'Dialer',
            'tunnel_interface': 'Tunnel',
            'supports_vlans': True,
            'supports_sfp': True,
            'qos_on_subint': True,
        },
        'cisco.c1111': {
            'vendor': 'CISCO', 'os': 'IOS-XE',
            'wan_interface': 'GigabitEthernet0/0/0',
            'lan_vlan_interface': 'Vlan',
            'loopback_interface': 'Loopback',
            'ppp_interface': 'Dialer',
            'tunnel_interface': 'Tunnel',
            'supports_vlans': True,
            'supports_sfp': False,
            'qos_on_subint': True,
        },
        'oneaccess.lbb150': {
            'vendor': 'ONEACCESS', 'os': 'ONEOS',
            'wan_interface': 'GigabitEthernet 1/0',
            'lan_vlan_interface': 'Bvi',
            'loopback_interface': 'Loopback ',
            'ppp_interface': 'virtual-template ppp ',
            'tunnel_interface': 'Tunnel ',
            'supports_vlans': False,
            'supports_sfp': False,
            'qos_on_subint': False,
        },
        'oneaccess.lbb154': {
            'vendor': 'ONEACCESS', 'os': 'ONEOS',
            'wan_interface': 'GigabitEthernet 1/0',
            'lan_vlan_interface': 'Bvi',
            'loopback_interface': 'Loopback ',
            'ppp_interface': 'virtual-template ppp ',
            'tunnel_interface': 'Tunnel ',
            'supports_vlans': False,
            'supports_sfp': False,
            'qos_on_subint': False,
        },
        'oneaccess.lbb400': {
            'vendor': 'ONEACCESS', 'os': 'ONEOS',
            'wan_interface': 'GigabitEthernet 1/0',
            'lan_vlan_interface': 'Bvi',
            'loopback_interface': 'Loopback ',
            'ppp_interface': 'virtual-template ppp ',
            'tunnel_interface': 'Tunnel ',
            'supports_vlans': False,
            'supports_sfp': False,
            'qos_on_subint': False,
        },
    }

    INTERFACE_ROLES = {
        'wan':            {'description': 'WAN Uplink',              'acl': 'ACL-WAN-IN',    'mtu': 1500},
        'lan':            {'description': 'Customer LAN',            'acl': '',               'mtu': 1500},
        'management':     {'description': 'Management Access',       'acl': 'ACL-MGMT-IN',   'mtu': 1500},
        'loopback_mgmt':  {'description': 'Management Loopback',     'acl': '',               'mtu': 32768},
        'nat_outside':    {'description': 'NAT Outside',             'acl': 'ACL-NAT-OUT',   'mtu': 1500},
        'nat_inside':     {'description': 'NAT Inside',              'acl': '',               'mtu': 1500},
        'tunnel':         {'description': 'IPsec/GRE Tunnel',        'acl': 'ACL-TUNNEL-IN', 'mtu': 1400},
        'cellular':       {'description': 'Cellular Backup (4G)',    'acl': '',               'mtu': 1500},
    }

    TRANSMISSION = {
        'ethernet':       {'encap': 'none',     'mtu': 1500, 'requires_ppp': False, 'dot1q': False},
        'gpon':           {'encap': 'pppoe',    'mtu': 1492, 'requires_ppp': True,  'dot1q': True},
        'vdsl_shared':    {'encap': 'pppoe',    'mtu': 1492, 'requires_ppp': True,  'dot1q': True,  'shared_vlan': True},
        'vdsl_dedicated': {'encap': 'dot1q',    'mtu': 1500, 'requires_ppp': False, 'dot1q': True},
        'explore':        {'encap': 'cellular', 'mtu': 1500, 'requires_ppp': False, 'dot1q': False, 'is_backup': True},
        'ipsec':          {'encap': 'ipsec',    'mtu': 1400, 'requires_ppp': False, 'dot1q': False, 'overhead_bytes': 100},
    }

    VENDOR_CLI = {
        'CISCO': {
            'vrf_create':        'ip vrf {vrf}',
            'vrf_assign':        'ip vrf forwarding {vrf}',
            'static_route':      'ip route vrf {vrf} {net} {mask} {nh}',
            'default_route':     'ip route vrf {vrf} 0.0.0.0 0.0.0.0 {nh}',
            'bgp_neighbor':      'neighbor {peer} remote-as {asn}',
            'bgp_activate':      'neighbor {peer} activate',
            'qos_apply':         'service-policy output {policy}',
            'ntp_server':        'ntp server {server}',
            'snmp_community':    'snmp-server community {community} RO',
            'syslog_host':       'logging host {host}',
        },
        'ONEACCESS': {
            'vrf_create':        'ip vrf {vrf}',
            'vrf_assign':        'ip vrf forwarding {vrf}',
            'static_route':      'ip route vrf {vrf} {net} {mask} {nh}',
            'default_route':     'ip route vrf {vrf} 0.0.0.0 0.0.0.0 {nh}',
            'bgp_neighbor':      'neighbor {peer} remote-as {asn}',
            'bgp_activate':      'neighbor {peer} activate',
            'qos_apply':         'traffic-policy {policy} out',
            'ntp_server':        'ntp server {server}',
            'snmp_community':    'snmp-server community {community} read-only',
            'syslog_host':       'logging {host}',
        },
    }
'''

GLOBAL_OBJECTS = [
    {
        "name": "net",
        "scope": "global",
        "description": (
            "Global networking constants: VLAN IDs, MTU values, QoS profiles/DSCP/queues, "
            "BGP communities/timers, routing admin distances, and ACL source definitions."
        ),
        "code": NET_CODE,
    },
    {
        "name": "router",
        "scope": "global",
        "description": (
            "Global CPE router reference data: hardware model profiles, interface roles, "
            "transmission type properties, and vendor CLI command templates (Cisco/OneAccess)."
        ),
        "code": ROUTER_CODE,
    },
]


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
        for attempt in range(5):
            r = getattr(self.http, method)(path, **kwargs)
            if r.status_code == 429:
                wait = 65
                print(f"  ⏱ Rate limited — waiting {wait}s before retry ({attempt+1}/5)...")
                time.sleep(wait)
                continue
            return r
        return r

    def post(self, path: str, data: dict):
        r = self._request("post", path, content=json.dumps(data))
        if r.status_code not in (200, 201):
            print(f"  ERROR {r.status_code}: {r.text[:300]}")
            r.raise_for_status()
        return r.json()


def get_token(base_url: str, username: str, password: str) -> str:
    for endpoint in ["/auth/login", "/auth/login/local"]:
        r = httpx.post(
            f"{base_url}{endpoint}",
            json={"username": username, "password": password},
            timeout=10,
        )
        if r.status_code == 200:
            return r.json()["access_token"]
        if r.status_code == 403 and "Local login is disabled" in r.text:
            continue
        print(f"Login failed at {endpoint}: {r.status_code} {r.text}")
        sys.exit(1)
    print("All login endpoints failed")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Seed logic
# ---------------------------------------------------------------------------

def seed(client: Client, dry_run: bool = False):
    print("\n── Seed global custom objects ─────────────────────────────────────────")

    # Fetch existing global objects by name
    # GET /admin/objects returns a list; filter client-side for scope=global
    try:
        all_objects = client.get("/admin/objects")
        existing_names = {
            obj["name"] for obj in (all_objects if isinstance(all_objects, list) else [])
            if obj.get("scope") == "global"
        }
    except Exception as e:
        existing_names = set()
        print(f"  ⚠ Could not fetch existing objects: {e}")

    for obj in GLOBAL_OBJECTS:
        if obj["name"] in existing_names:
            print(f"  ✓ Object '{obj['name']}' already exists (scope=global) — skipping")
            continue

        if dry_run:
            print(f"  [dry-run] Would create global object '{obj['name']}'")
            continue

        result = client.post("/admin/objects", obj)
        print(f"  ✓ Created global object '{obj['name']}' id={result['id']}")

    print("\n── Seed complete ──────────────────────────────────────────────────────")
    print("  Global objects: net, router")
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Seed global custom objects (net, router) in Templarc")
    parser.add_argument("--base-url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--token", help="JWT bearer token (overrides login)")
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
    seed(client, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
