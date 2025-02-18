from flask import Flask, request, jsonify, make_response
from flask_cors import CORS
import subprocess
import datetime


app = Flask(__name__)
CORS(app)  # allow CORS

sessions = {}

logfile = "/home/ubuntu/workspace/gs-edit/webrtc/log.txt"

def print_log(*message):
    with open(logfile, "a") as f:
        if len(message) == 0:
            print(file=f)
        else:
            print(datetime.datetime.now(), message, file=f)


@app.route('/signaling/<string:sessionId>', methods=['POST'])
def create_or_update_session(sessionId):
    """
    POST /signaling/<sessionId>
    """
    data = request.get_json()
    type_ = data.get('type')
    sdp = data.get('sdp')
    candidate = data.get('candidate')

    print_log('Current sessions:', list(sessions.keys()))

    if sessionId not in sessions:
        print_log('Create session', sessionId)
        sessions[sessionId] = {}

    if type_ not in sessions[sessionId]:
        sessions[sessionId][type_] = {}
        sessions[sessionId][type_]['sdp'] = ""
        sessions[sessionId][type_]['candidate'] = ""

    if sdp:
        if sessions[sessionId][type_]['sdp'] != sdp:
            print_log('Set session', sessionId, type_, sdp)
            sessions[sessionId][type_]['sdp'] = sdp
    if candidate:
        if candidate['sdpMid'] == "3":
            print_log('discard', sessionId, type_, candidate)
        elif ".local" in candidate['candidate']:
            print_log('discard', sessionId, type_, candidate)
        elif sessions[sessionId][type_]['candidate'] != candidate:
            print_log('Set session', sessionId, type_, candidate)
            sessions[sessionId][type_]['candidate'] = candidate

    return jsonify({'status': 'ok'}), 200


@app.route('/signaling/<string:sessionId>', methods=['GET'])
def get_session_info(sessionId):
    """
    GET /signaling/<sessionId>?type={offer|answer}
    """
    type_ = request.args.get('type')

    session = sessions.get(sessionId)
    if not session or type_ not in session:
        return 'Not found', 404

    return jsonify(session[type_]), 200


@app.route('/signaling/<string:sessionId>', methods=['DELETE'])
def delete_session(sessionId):
    """
    DELETE /signaling/<sessionId>
    """
    print_log('Delete session', sessionId)
    if sessionId in sessions:
        del sessions[sessionId]
    print_log('Current sessions:', list(sessions.keys()))
    return jsonify({'status': 'deleted'}), 200


p = None
# NOTE: On subsequent `launch`, chrome may merge new windows into the first process,
# so we only manage the initial process.
@app.route('/launch', methods=['POST'])
def launch():
    """
    POST /launch
    Body (JSON例): {
      "gvrm": "./assets/avatar.gvrm",
      "session": "test"
    }
    """
    global p
    data = request.get_json()
    gvrm = data.get("gvrm")
    print_log('API: launch', data)
    session = data.get("session")
    # chrome_path = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
    chrome_path = "google-chrome"
    url = f"https://naruya.github.io/gs-edit/?gvrm={gvrm}&scale=1.05&fast&signaling=auto&host=local&session={session}&size=1440,1620"

    try:
        if p is None:
            p = subprocess.Popen([chrome_path, "--new-window", url])
        else:
            p_sub = subprocess.Popen([chrome_path, "--new-window", url])
        return jsonify({"status": "Chrome launched", "url": url}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/kill', methods=['POST'])
def kill():
    """
    POST /kill
    """
    global p
    print_log('API: kill')
    try:
        p.terminate()
        p = None
        return jsonify({"status": "Chrome killed"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


commands = []
@app.route('/command', methods=['POST'])
def get_command():
    """
    POST /command
    Body (JSON例): {
      "cmd": "move"
    }
    """
    data = request.get_json()
    print_log('API: command', data)
    if p is None:
        return jsonify({"error": "No current process."}), 500
    else:
        commands.append(data.get("cmd"))
        return jsonify({"status": "ok"}), 200


@app.route('/command', methods=['GET'])
def send_command():
    """
    GET /command
    """
    if len(commands) > 0:
        cmd = commands.pop(0)
        print_log('remaining commands:', commands)
        return jsonify({"cmd": cmd}), 200
    else:
        return jsonify({"cmd": ""}), 200


# for CORS, OPTION? OPTIONS?
@app.route('/signaling/<string:sessionId>', methods=['OPTION'])
def return_ok(sessionId):
    response = make_response()
    return response, 200

@app.route('/launch', methods=['OPTION'])
def return_ok2(sessionId):
    response = make_response()
    return response, 200


if __name__ == '__main__':
    print_log()
    app.run(host='0.0.0.0', port=3000, debug=True, use_reloader=False)
