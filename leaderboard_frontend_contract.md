# Leaderboard submission fields

The submission page registers an existing evaluation. It does not start an evaluation or calculate scores.

## Request

`POST /api/v1/leaderboards/{leaderboard_id}/evaluations`

```json
{
  "evaluation_id": "eval_20261028_001",
  "submission_type": "agent",
  "team_name": "Example Robotics",
  "organization": "Example University",
  "policy_name": "my_policy_v1",
  "email": "researcher@example.com",
  "contact_method": "wechat",
  "contact_value": "example_researcher",
  "participant_endpoint": "https://agent.example.com/v1"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `evaluation_id` | Yes | Existing evaluation ID from the evaluation service. |
| `submission_type` | Yes | `agent` or `model`. |
| `team_name` | Yes | Team name, up to 100 characters. |
| `organization` | Yes | University, company, or independent affiliation, up to 150 characters. |
| `policy_name` | Yes | Public policy name, up to 100 characters. |
| `email` | Yes | Contact email, up to 254 characters. |
| `contact_method` | Yes | `phone` or `wechat`. |
| `contact_value` | Yes | Phone number or WeChat ID for the selected method. |
| `participant_endpoint` | No | Optional policy API URL; HTTP(S), without credentials, query parameters, or a fragment. |

The form trims all profile fields. Phone input accepts common separators and an optional leading `+`; it sends 7–15 digits with separators removed, preserving `+`. WeChat input accepts nonempty IDs without whitespace, up to 64 characters. Switching methods keeps separate temporary drafts so a phone number is not inadvertently submitted as a WeChat ID.

The URL's `leaderboard_id` remains the benchmark/season identifier. It is separate from the policy name. Existing rankings responses may continue returning the public policy name as their row-level `leaderboard_id` or `display_name`.

## Service integration

This repository contains the static frontend and an in-browser demo fixture, not the production evaluation service. The real service must accept, validate, and persist the six new profile/contact fields before deployment of this form. These fields extend the existing endpoint; servers that reject unknown fields need a matching schema update. Validate required values on the server as well, including the email format and selected contact method.

Keep contact email, phone number, and WeChat ID out of public ranking and evaluation-list responses. The frontend does not store these fields in localStorage or sessionStorage, put them in URLs, or display them in public tables. The demo keeps contacts in memory separately from public evaluation records; demo data resets on reload.

The existing authenticated JSON request, status polling, record lookup, and score handling are unchanged. Successful registration returns an evaluation ID and state, for example:

```json
{ "evaluation_id": "eval_20261028_001", "status": "queued" }
```

The server remains responsible for authorization and idempotency. It must never accept a client-supplied score. Use HTTP error statuses for rejected submissions; the frontend reports those failures rather than fabricating a result.
