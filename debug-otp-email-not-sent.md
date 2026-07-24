# Debug Session: otp-email-not-sent

Status: [OPEN]

## Symptom
OTP email is not arriving. User suspects backend issue. Existing indication: Brevo SMTP may be rejecting requests due to unauthorized IP.

## Hypotheses
1. Brevo SMTP rejects login because backend server IP is not authorized.
2. Backend email environment variables use wrong SMTP username/password/host/port.
3. OTP generation succeeds but email send function is not called or wrong recipient is passed.
4. Email send succeeds but sender/domain verification or spam filtering prevents delivery.
5. Backend catches email errors and returns success response, hiding the real failure from frontend.

## Evidence Log
Pending: inspect provided deployment log and collect runtime evidence before modifying business logic.

## Next Steps
1. Read provided log file.
2. Locate email service and OTP flow.
3. Add minimal instrumentation only if logs are insufficient.
4. Use evidence to decide minimal fix.
