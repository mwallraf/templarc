"""
Demo seed data for Templarc.

Called from api/main.py lifespan when SEED_ON_STARTUP=True.
Idempotent: returns immediately if organisation 'templarc_demo' already exists.

Seed hierarchy
--------------
Organization : templarc_demo
├── Global params  : glob.ntp_server, glob.dns_server
└── Project        : router_provisioning  (git_path="routers", comment_style="#")
    ├── Project params : proj.default_vrf, proj.loopback_prefix
    └── Templates (catalog tree):
        ├── cpe_base  (parent=None)        routers/cpe_base.j2
        │     params : router.hostname (req), router.mgmt_ip (req), router.mgmt_mask
        ├── cisco     (parent=cpe_base)    routers/cisco.j2
        │     params : cisco.ios_version, cisco.enable_secret (hidden)
        └── cisco_891 (parent=cisco)       routers/cisco_891.j2
              params : cisco891.bandwidth_mb (number)  — demos mb_to_kbps filter
"""

from __future__ import annotations

import logging
import textwrap

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.models.organization import Organization
from api.models.parameter import Parameter, ParameterScope, WidgetType
from api.models.project import Project
from api.models.template import Template
from api.services.git_service import GitService

logger = logging.getLogger(__name__)

_SEED_ORG_NAME = "templarc_demo"

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
        git_path="routers",
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
    git_service.write_template(
        "routers/cpe_base.j2", _CPE_BASE_J2,
        "seed: add cpe_base template", "seed",
    )
    cpe_base = Template(
        project_id=project.id,
        name="cpe_base",
        display_name="CPE Base",
        description="Base template — hostname, NTP, DNS, management interface.",
        git_path="routers/cpe_base.j2",
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
    git_service.write_template(
        "routers/cisco.j2", _CISCO_J2,
        "seed: add cisco template", "seed",
    )
    cisco = Template(
        project_id=project.id,
        parent_template_id=cpe_base.id,
        name="cisco",
        display_name="Cisco IOS",
        description="Cisco IOS template — inherits CPE Base, adds IOS-specific params.",
        git_path="routers/cisco.j2",
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
    git_service.write_template(
        "routers/cisco_891.j2", _CISCO_891_J2,
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
        git_path="routers/cisco_891.j2",
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

    logger.info(
        "Seed data created: org=%s  project=%s  templates=[cpe_base, cisco, cisco_891]",
        org.name, project.name,
    )
