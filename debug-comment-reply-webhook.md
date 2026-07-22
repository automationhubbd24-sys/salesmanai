# Debug Session: comment-reply-webhook

Status: [OPEN]

## Symptom
Messenger / Instagram / Facebook comment reply not working. User commented `price ?`, but provided app logs did not show the event.

## Hypotheses
1. Meta webhook is not receiving comment events because the app/page subscription is missing or wrong.
2. Webhook receives the request, but signature/body parsing or route filtering drops the event before logging.
3. The comment is created as a personal profile/user comment context not covered by the connected Page/Instagram permissions.
4. The webhook route logs only certain event types, so comment events are ignored before ai reply logic.
5. Production/deployed service receiving webhook is not the same code/log stream being checked.

## Evidence Plan
- Inspect existing local code paths for Meta webhook handling and comment reply flow.
- Inspect provided deployment log file for webhook startup/errors and inbound Meta requests.
- Add minimal instrumentation only around webhook ingress and comment event branching.
- Reproduce by commenting again and compare debug logs.

## Notes
No business logic changes before runtime evidence.
