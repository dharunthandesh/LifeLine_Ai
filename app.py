import os
from flask import Flask, render_template, jsonify, request
from twilio.rest import Client

app = Flask(__name__)

# ==========================================
# Twilio Configuration
# Get these credentials from your Twilio Console: https://console.twilio.com/
# ==========================================
TWILIO_ACCOUNT_SID = os.environ.get('TWILIO_ACCOUNT_SID', 'your_account_sid_here')
TWILIO_AUTH_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN', 'your_auth_token_here')
TWILIO_PHONE_NUMBER = os.environ.get('TWILIO_PHONE_NUMBER', '+14482304852')
DESTINATION_PHONE_NUMBER = os.environ.get('DESTINATION_PHONE_NUMBER', '+918825642045')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/alert', methods=['POST'])
def trigger_alert():
    data   = request.json
    reason = data.get('reason', 'Unknown reason')
    lat    = data.get('lat')
    lng    = data.get('lng')
    atype  = data.get('type', 'both')   # 'sms' | 'call' | 'both'

    print(f"[EMERGENCY ALERT] type={atype} | Reason: {reason} | lat={lat}, lng={lng}")

    # Build location strings
    if lat is not None and lng is not None:
        maps_url      = f"https://maps.google.com/?q={lat},{lng}"
        location_text = f"Location: {maps_url}"
        location_say  = f"Location: latitude {round(lat, 4)}, longitude {round(lng, 4)}."
    else:
        maps_url      = None
        location_text = "Location: unavailable"
        location_say  = "Location could not be determined."

    sms_body = (
        f"🚨 LIFELINE AI EMERGENCY ALERT\n"
        f"Reason: {reason}\n"
        f"{location_text}\n"
        f"Please check on the user immediately!"
    )

    twiml_message = (
        f"<Response><Say>"
        f"Emergency alert triggered from LifeLine AI. "
        f"Reason: {reason}. "
        f"{location_say} "
        f"Please check on the user immediately."
        f"</Say></Response>"
    )

    try:
        if TWILIO_ACCOUNT_SID != 'your_account_sid_here':
            client  = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
            result  = {"status": "success", "location": maps_url}

            # ── Send SMS (phase 1) ──
            if atype in ('sms', 'both'):
                msg = client.messages.create(
                    body=sms_body,
                    to=DESTINATION_PHONE_NUMBER,
                    from_=TWILIO_PHONE_NUMBER
                )
                print(f"SMS sent. SID: {msg.sid}")
                result["sms_sid"] = msg.sid

            # ── Make voice call (phase 2) ──
            if atype in ('call', 'both'):
                call = client.calls.create(
                    twiml=twiml_message,
                    to=DESTINATION_PHONE_NUMBER,
                    from_=TWILIO_PHONE_NUMBER
                )
                print(f"Voice call initiated. SID: {call.sid}")
                result["call_sid"] = call.sid

            return jsonify(result)

        else:
            print(f"[DEMO MODE] type={atype}")
            print(f"[DEMO] SMS would be: {sms_body}")
            return jsonify({
                "status":   "success",
                "message":  f"Demo mode — would have sent {atype}. Configure Twilio credentials to enable.",
                "location": maps_url
            })

    except Exception as e:
        print(f"Twilio error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
