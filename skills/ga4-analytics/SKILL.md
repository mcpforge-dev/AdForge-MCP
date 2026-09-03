---
name: ga4-analytics
description: Use the HolyMedia MCP Google Analytics 4 tools to investigate traffic, acquisition, content, events and period changes without changing GA4 configuration or data.
---

# Google Analytics 4

Use this workflow only after the caller has selected an enabled Google Analytics property in the current HolyMedia workspace. All GA4 MCP tools are read-only: never attempt to change a property, stream, event, audience, conversion/key event, link, attribution setting, or user access.

## Start safely

1. Call `google_analytics_list_properties` and ask which property to use if more than one is enabled.
2. Call `google_analytics_get_property` to confirm the property name, timezone and currency.
3. Use the property timezone when describing calendar periods. State the requested dates in every result.
4. If a metric or dimension is uncertain, call `google_analytics_check_compatibility` before `google_analytics_run_report`.
5. If GA4 returns no rows, say that there is no data for the selected property and period; do not infer zero traffic or zero conversions.

## Traffic diagnosis

Use `google_analytics_traffic_overview` for the requested period. Report active users, sessions, engagement, views, key events and revenue only when returned by GA4. Distinguish measurement from an explanation: a traffic change is a fact; its cause is a hypothesis until supported by another source.

## Acquisition

Use `google_analytics_acquisition` with the default `sessionSourceMedium`, or a compatible requested dimension. Explain channel grouping exactly as returned. Do not add advertising spend, ROAS, or campaign performance unless an ad provider report is separately queried and the date range, timezone, currency and attribution limitations are made explicit.

## Landing pages and content

Use `google_analytics_landing_pages` for entry pages and `google_analytics_pages` for content consumption. Flag pages with low engagement or no key events as candidates for investigation, not proven defects. For each observation include the page/path, period, returned metric and a next diagnostic step.

## Events and key events

Use `google_analytics_events` and `google_analytics_key_events`. A key-event total is a GA4 measurement, not automatically a lead, sale or qualified conversion. Ask for the event definition before making business conclusions.

## Devices, geography and realtime

Use `google_analytics_devices`, `google_analytics_geography` and `google_analytics_realtime` only for the requested question. Realtime is a current snapshot and must not be compared as if it were a completed daily period.

## Compare periods

Use `google_analytics_compare_periods` for equal, explicit periods. Report both ranges and percentage/absolute changes exactly from returned data. Do not compare incomplete today data against completed historical days without flagging the limitation.

## Google Ads links and custom definitions

Use `google_analytics_list_google_ads_links` only to inspect existing GA4-to-Google-Ads links. It never proves that Google Ads metrics and GA4 metrics are directly comparable. Use `google_analytics_get_custom_dimensions_metrics` before requesting custom fields; do not guess their names or meanings.

## Safe result format

Return: selected property, timezone, period, source tool, observed values, data gaps, and clearly labelled hypotheses. Never claim write access or suggest that a tool changed Google Analytics.
