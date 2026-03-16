"""
Demo seed data for Templarc.

Called from api/main.py lifespan when SEED_ON_STARTUP=True.
Idempotent: returns immediately if organisation 'templarc_demo' already exists.

Seed hierarchy
--------------
Organization : templarc_demo
├── Global params  : glob.ntp_server, glob.dns_server
└── Project        : router_provisioning  (git_path="router_provisioning", comment_style="#")
    ├── Project params : proj.default_vrf, proj.loopback_prefix
    └── Templates (catalog tree):
        ├── cpe_base  (parent=None)        router_provisioning/cpe_base.j2
        │     params : router.hostname (req), router.mgmt_ip (req), router.mgmt_mask
        ├── cisco     (parent=cpe_base)    router_provisioning/cisco.j2
        │     params : cisco.ios_version, cisco.enable_secret (hidden)
        └── cisco_891 (parent=cisco)       router_provisioning/cisco_891.j2
              params : cisco891.bandwidth_mb (number)  — demos mb_to_kbps filter
"""

from __future__ import annotations

import logging
import textwrap

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.custom_object import CustomObject
from api.models.organization import Organization
from api.models.parameter import Parameter, ParameterScope, WidgetType
from api.models.project import Project
from api.models.template import Template
from api.services.git_service import GitService

logger = logging.getLogger(__name__)

_SEED_ORG_NAME = "templarc_demo"


def _safe_write_template(
    git_service: "GitService",
    path: str,
    content: str,
    message: str,
    author: str,
) -> None:
    """Write a template to Git, ignoring chmod errors on macOS Docker Desktop bind mounts."""
    try:
        git_service.write_template(path, content, message, author)
    except PermissionError as exc:
        logger.warning(
            "seed: git chmod failed (macOS Docker Desktop bind mount?) — "
            "skipping git write for %s: %s",
            path,
            exc,
        )

# ---------------------------------------------------------------------------
# Template file content
# ---------------------------------------------------------------------------

_CPE_BASE_J2 = textwrap.dedent("""\
    ---
    parameters:
      - name: router.hostname
        widget: text
        label: Hostname
        required: true
      - name: router.mgmt_ip
        widget: text
        label: Management IP
        required: true
      - name: router.mgmt_mask
        widget: text
        label: Management Mask
        required: false
    ---
    hostname {{ router.hostname }}
    !
    ntp server {{ glob.ntp_server }}
    ip name-server {{ glob.dns_server }}
    !
    ip vrf {{ proj.default_vrf }}
    !
    interface Loopback0
     description Management
     ip address {{ router.mgmt_ip }} {{ router.mgmt_mask | default('255.255.255.0') }}
    """)

_CISCO_J2 = textwrap.dedent("""\
    ---
    parameters:
      - name: cisco.ios_version
        widget: text
        label: IOS Version
        required: false
      - name: cisco.enable_secret
        widget: hidden
        label: Enable Secret
        required: false
    ---
    hostname {{ router.hostname }}
    !
    ! IOS Version: {{ cisco.ios_version | default('15.x') }}
    enable secret {{ cisco.enable_secret | default('cisco') }}
    !
    ntp server {{ glob.ntp_server }}
    ip name-server {{ glob.dns_server }}
    !
    ip vrf {{ proj.default_vrf }}
    !
    interface Loopback0
     ip address {{ router.mgmt_ip }} {{ router.mgmt_mask | default('255.255.255.0') }}
    """)

_CISCO_891_J2 = textwrap.dedent("""\
    ---
    parameters:
      - name: cisco891.bandwidth_mb
        widget: number
        label: "WAN Bandwidth (Mbps)"
        required: false
    ---
    ! Cisco 891 -- {{ router.hostname }}
    hostname {{ router.hostname }}
    !
    ! IOS Version: {{ cisco.ios_version | default('15.x') }}
    enable secret {{ cisco.enable_secret | default('cisco') }}
    !
    ntp server {{ glob.ntp_server }}
    ip name-server {{ glob.dns_server }}
    !
    ip vrf {{ proj.default_vrf }}
    !
    interface Loopback0
     ip address {{ router.mgmt_ip }} {{ router.mgmt_mask | default('255.255.255.0') }}
    !
    interface FastEthernet0
     bandwidth {{ cisco891.bandwidth_mb | default(100) | mb_to_kbps }}
     no shutdown
    """)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def seed_database(db: AsyncSession, git_service: GitService) -> None:
    """
    Populate the database and template git repo with demo data.

    Safe to call on every startup — returns immediately if the seed
    organisation already exists.  The caller is responsible for committing
    the session after this function returns.
    """
    # Guard: idempotent
    result = await db.execute(
        select(Organization).where(Organization.name == _SEED_ORG_NAME)
    )
    if result.scalar_one_or_none() is not None:
        logger.info("Seed data already present — skipping")
        return

    logger.info("Seeding demo data …")

    # 1. Organisation
    org = Organization(name=_SEED_ORG_NAME, display_name="Templarc Demo")
    db.add(org)
    await db.flush()

    # 2. Global parameters
    for sort_order, (name, label, default) in enumerate([
        ("glob.ntp_server", "NTP Server",  "pool.ntp.org"),
        ("glob.dns_server", "DNS Server",  "8.8.8.8"),
    ]):
        db.add(Parameter(
            organization_id=org.id,
            name=name,
            scope=ParameterScope.global_,
            widget_type=WidgetType.text,
            label=label,
            default_value=default,
            required=False,
            sort_order=sort_order,
        ))
    await db.flush()

    # 3. Project
    project = Project(
        organization_id=org.id,
        name="router_provisioning",
        display_name="Router Provisioning",
        description="Demo project — network router configuration templates.",
        git_path="router_provisioning",
        output_comment_style="#",
    )
    db.add(project)
    await db.flush()

    # 4. Project parameters
    for sort_order, (name, label, default) in enumerate([
        ("proj.default_vrf",     "Default VRF",      "MGMT"),
        ("proj.loopback_prefix", "Loopback Prefix",  "10.0.0.0/24"),
    ]):
        db.add(Parameter(
            project_id=project.id,
            name=name,
            scope=ParameterScope.project,
            widget_type=WidgetType.text,
            label=label,
            default_value=default,
            required=False,
            sort_order=sort_order,
        ))
    await db.flush()

    # 5. Templates — written to Git then registered in DB
    # 5a. CPE Base (root of inheritance chain)
    _safe_write_template(
        git_service, "router_provisioning/cpe_base.j2", _CPE_BASE_J2,
        "seed: add cpe_base template", "seed",
    )
    cpe_base = Template(
        project_id=project.id,
        name="cpe_base",
        display_name="CPE Base",
        description="Base template — hostname, NTP, DNS, management interface.",
        git_path="router_provisioning/cpe_base.j2",
        sort_order=0,
    )
    db.add(cpe_base)
    await db.flush()

    for sort_order, (name, label, required, default) in enumerate([
        ("router.hostname",  "Hostname",        True,  None),
        ("router.mgmt_ip",   "Management IP",   True,  None),
        ("router.mgmt_mask", "Management Mask", False, "255.255.255.0"),
    ]):
        db.add(Parameter(
            template_id=cpe_base.id,
            name=name,
            scope=ParameterScope.template,
            widget_type=WidgetType.text,
            label=label,
            default_value=default,
            required=required,
            sort_order=sort_order,
        ))
    await db.flush()

    # 5b. Cisco (child of cpe_base)
    _safe_write_template(
        git_service, "router_provisioning/cisco.j2", _CISCO_J2,
        "seed: add cisco template", "seed",
    )
    cisco = Template(
        project_id=project.id,
        parent_template_id=cpe_base.id,
        name="cisco",
        display_name="Cisco IOS",
        description="Cisco IOS template — inherits CPE Base, adds IOS-specific params.",
        git_path="router_provisioning/cisco.j2",
        sort_order=1,
    )
    db.add(cisco)
    await db.flush()

    for sort_order, (name, label, widget, required) in enumerate([
        ("cisco.ios_version",   "IOS Version",   WidgetType.text,   False),
        ("cisco.enable_secret", "Enable Secret", WidgetType.hidden, False),
    ]):
        db.add(Parameter(
            template_id=cisco.id,
            name=name,
            scope=ParameterScope.template,
            widget_type=widget,
            label=label,
            required=required,
            sort_order=sort_order,
        ))
    await db.flush()

    # 5c. Cisco 891 (child of cisco — leaf template)
    _safe_write_template(
        git_service, "router_provisioning/cisco_891.j2", _CISCO_891_J2,
        "seed: add cisco_891 template", "seed",
    )
    cisco_891 = Template(
        project_id=project.id,
        parent_template_id=cisco.id,
        name="cisco_891",
        display_name="Cisco 891",
        description=(
            "Cisco 891 leaf template — demonstrates the mb_to_kbps Jinja2 filter "
            "and the full three-tier parameter hierarchy."
        ),
        git_path="router_provisioning/cisco_891.j2",
        sort_order=2,
    )
    db.add(cisco_891)
    await db.flush()

    db.add(Parameter(
        template_id=cisco_891.id,
        name="cisco891.bandwidth_mb",
        scope=ParameterScope.template,
        widget_type=WidgetType.number,
        label="WAN Bandwidth (Mbps)",
        default_value="100",
        required=False,
        sort_order=0,
    ))
    await db.flush()

    # 6. Global custom objects (net, router) — project_id=None means available everywhere
    _GLOBAL_OBJECTS = [
        {
            "name": "net",
            "description": (
                "Global networking constants: VLAN IDs, MTU values, QoS profiles/DSCP/queues, "
                "BGP communities/timers, routing admin distances, and ACL source definitions."
            ),
            "code": (
                "class net:\n"
                "    VLANS = {\n"
                "        'management': 99, 'voice': 10, 'data': 20,\n"
                "        'guest': 30, 'iot': 40, 'wan': 100, 'dmz': 50,\n"
                "    }\n"
                "    MTU = {\n"
                "        'ethernet': 1500, 'mpls': 1508, 'gre': 1476,\n"
                "        'ipsec': 1400, 'pppoe': 1492, 'jumbo': 9000, 'vxlan': 1450,\n"
                "    }\n"
                "    QOS = {\n"
                "        'profiles': {\n"
                "            'standard': 'WAN-QOS-STD', 'premium': 'WAN-QOS-PREMIUM',\n"
                "            'voice': 'WAN-QOS-VOICE', 'best_effort': 'WAN-QOS-BE',\n"
                "        },\n"
                "        'dscp': {\n"
                "            'ef': 46, 'cs5': 40, 'af41': 34, 'af31': 26,\n"
                "            'af21': 18, 'af11': 10, 'cs0': 0,\n"
                "        },\n"
                "        'queues': {\n"
                "            'voice':       {'dscp': 'ef',   'bandwidth_pct': 20, 'priority': True},\n"
                "            'interactive': {'dscp': 'af41', 'bandwidth_pct': 30, 'priority': False},\n"
                "            'business':    {'dscp': 'af31', 'bandwidth_pct': 30, 'priority': False},\n"
                "            'best_effort': {'dscp': 'cs0',  'bandwidth_pct': 20, 'priority': False},\n"
                "        },\n"
                "    }\n"
                "    BGP = {\n"
                "        'communities': {\n"
                "            'default_route': '65000:1', 'no_export': '65000:100',\n"
                "            'blackhole': '65000:666', 'backup_only': '65000:200',\n"
                "        },\n"
                "        'timers': {'keepalive': 10, 'hold': 30},\n"
                "    }\n"
                "    ROUTING = {\n"
                "        'admin_distance': {\n"
                "            'static': 1, 'ospf': 110, 'bgp_ebgp': 20, 'bgp_ibgp': 200,\n"
                "        },\n"
                "        'ospf_area': 0,\n"
                "        'bgp_asn': 65000,\n"
                "    }\n"
                "    ACLS = {\n"
                "        'mgmt_sources': ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],\n"
                "        'ntp_servers': ['10.1.1.1', '10.1.1.2'],\n"
                "        'syslog_server': '10.1.2.100',\n"
                "        'snmp_hosts': ['10.1.3.1', '10.1.3.2'],\n"
                "        'tacacs_server': '10.1.4.1',\n"
                "    }\n"
            ),
        },
        {
            "name": "router",
            "description": (
                "Global CPE router reference data: hardware model profiles, interface roles, "
                "transmission type properties, and vendor CLI command templates (Cisco/OneAccess)."
            ),
            "code": (
                "class router:\n"
                "    CPE_MODELS = {\n"
                "        'cisco.c891f': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS',\n"
                "            'wan_interface': 'GigabitEthernet8',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': True, 'qos_on_subint': True,\n"
                "        },\n"
                "        'cisco.c1111': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS-XE',\n"
                "            'wan_interface': 'GigabitEthernet0/0/0',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': False, 'qos_on_subint': True,\n"
                "        },\n"
                "        'cisco.c2921': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS',\n"
                "            'wan_interface': 'GigabitEthernet0/0',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': True, 'qos_on_subint': True,\n"
                "        },\n"
                "        'cisco.asr1001-x': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS-XE',\n"
                "            'wan_interface': 'GigabitEthernet0/0/0',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': True, 'qos_on_subint': True,\n"
                "        },\n"
                "        'cisco.c8300-1n1s-4t2x': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS-XE',\n"
                "            'wan_interface': 'GigabitEthernet0/0/0',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': True, 'qos_on_subint': True,\n"
                "        },\n"
                "        'cisco.c8300-1n1s-6t': {\n"
                "            'vendor': 'CISCO', 'os': 'IOS-XE',\n"
                "            'wan_interface': 'GigabitEthernet0/0/0',\n"
                "            'lan_vlan_interface': 'Vlan', 'loopback_interface': 'Loopback',\n"
                "            'ppp_interface': 'Dialer', 'tunnel_interface': 'Tunnel',\n"
                "            'supports_vlans': True, 'supports_sfp': True, 'qos_on_subint': True,\n"
                "        },\n"
                "        'oneaccess.lbb150': {\n"
                "            'vendor': 'ONEACCESS', 'os': 'ONEOS',\n"
                "            'wan_interface': 'GigabitEthernet 1/0',\n"
                "            'lan_vlan_interface': 'Bvi', 'loopback_interface': 'Loopback ',\n"
                "            'ppp_interface': 'virtual-template ppp ', 'tunnel_interface': 'Tunnel ',\n"
                "            'supports_vlans': False, 'supports_sfp': False, 'qos_on_subint': False,\n"
                "        },\n"
                "        'oneaccess.lbb154': {\n"
                "            'vendor': 'ONEACCESS', 'os': 'ONEOS',\n"
                "            'wan_interface': 'GigabitEthernet 1/0',\n"
                "            'lan_vlan_interface': 'Bvi', 'loopback_interface': 'Loopback ',\n"
                "            'ppp_interface': 'virtual-template ppp ', 'tunnel_interface': 'Tunnel ',\n"
                "            'supports_vlans': False, 'supports_sfp': False, 'qos_on_subint': False,\n"
                "        },\n"
                "        'oneaccess.lbb400': {\n"
                "            'vendor': 'ONEACCESS', 'os': 'ONEOS',\n"
                "            'wan_interface': 'GigabitEthernet 1/0',\n"
                "            'lan_vlan_interface': 'Bvi', 'loopback_interface': 'Loopback ',\n"
                "            'ppp_interface': 'virtual-template ppp ', 'tunnel_interface': 'Tunnel ',\n"
                "            'supports_vlans': False, 'supports_sfp': False, 'qos_on_subint': False,\n"
                "        },\n"
                "    }\n"
                "    INTERFACE_ROLES = {\n"
                "        'wan':           {'description': 'WAN Uplink',           'acl': 'ACL-WAN-IN',    'mtu': 1500},\n"
                "        'lan':           {'description': 'Customer LAN',         'acl': '',              'mtu': 1500},\n"
                "        'management':    {'description': 'Management Access',    'acl': 'ACL-MGMT-IN',   'mtu': 1500},\n"
                "        'loopback_mgmt': {'description': 'Management Loopback',  'acl': '',              'mtu': 32768},\n"
                "        'nat_outside':   {'description': 'NAT Outside',          'acl': 'ACL-NAT-OUT',   'mtu': 1500},\n"
                "        'nat_inside':    {'description': 'NAT Inside',           'acl': '',              'mtu': 1500},\n"
                "        'tunnel':        {'description': 'IPsec/GRE Tunnel',     'acl': 'ACL-TUNNEL-IN', 'mtu': 1400},\n"
                "        'cellular':      {'description': 'Cellular Backup (4G)', 'acl': '',              'mtu': 1500},\n"
                "    }\n"
                "    TRANSMISSION = {\n"
                "        'ethernet':       {'encap': 'none',     'mtu': 1500, 'requires_ppp': False, 'dot1q': False},\n"
                "        'gpon':           {'encap': 'pppoe',    'mtu': 1492, 'requires_ppp': True,  'dot1q': True},\n"
                "        'vdsl_shared':    {'encap': 'pppoe',    'mtu': 1492, 'requires_ppp': True,  'dot1q': True},\n"
                "        'vdsl_dedicated': {'encap': 'dot1q',    'mtu': 1500, 'requires_ppp': False, 'dot1q': True},\n"
                "        'explore':        {'encap': 'cellular', 'mtu': 1500, 'requires_ppp': False, 'dot1q': False},\n"
                "        'ipsec':          {'encap': 'ipsec',    'mtu': 1400, 'requires_ppp': False, 'dot1q': False},\n"
                "    }\n"
                "    VENDOR_CLI = {\n"
                "        'CISCO': {\n"
                "            'vrf_create': 'ip vrf {vrf}', 'vrf_assign': 'ip vrf forwarding {vrf}',\n"
                "            'static_route': 'ip route vrf {vrf} {net} {mask} {nh}',\n"
                "            'default_route': 'ip route vrf {vrf} 0.0.0.0 0.0.0.0 {nh}',\n"
                "            'bgp_neighbor': 'neighbor {peer} remote-as {asn}',\n"
                "            'bgp_activate': 'neighbor {peer} activate',\n"
                "            'qos_apply': 'service-policy output {policy}',\n"
                "            'ntp_server': 'ntp server {server}',\n"
                "            'snmp_community': 'snmp-server community {community} RO',\n"
                "            'syslog_host': 'logging host {host}',\n"
                "        },\n"
                "        'ONEACCESS': {\n"
                "            'vrf_create': 'ip vrf {vrf}', 'vrf_assign': 'ip vrf forwarding {vrf}',\n"
                "            'static_route': 'ip route vrf {vrf} {net} {mask} {nh}',\n"
                "            'default_route': 'ip route vrf {vrf} 0.0.0.0 0.0.0.0 {nh}',\n"
                "            'bgp_neighbor': 'neighbor {peer} remote-as {asn}',\n"
                "            'bgp_activate': 'neighbor {peer} activate',\n"
                "            'qos_apply': 'traffic-policy {policy} out',\n"
                "            'ntp_server': 'ntp server {server}',\n"
                "            'snmp_community': 'snmp-server community {community} read-only',\n"
                "            'syslog_host': 'logging {host}',\n"
                "        },\n"
                "    }\n"
            ),
        },
    ]
    for obj_def in _GLOBAL_OBJECTS:
        db.add(CustomObject(
            name=obj_def["name"],
            code=obj_def["code"],
            description=obj_def["description"],
            project_id=None,  # global
            created_by="seed",
        ))
    await db.flush()

    logger.info(
        "Seed data created: org=%s  project=%s  templates=[cpe_base, cisco, cisco_891]  objects=[net, router]",
        org.name, project.name,
    )
