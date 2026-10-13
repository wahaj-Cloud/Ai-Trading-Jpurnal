export const metadata = { title: "Terms of service" };

/** Template. Have it reviewed by a lawyer before launch. */
export default function Terms() {
  return (
    <>
      <h1>Terms of service</h1>
      <p>
        Last updated: [date]. These terms are an agreement between you and [Company legal name].
      </p>
      <h2>The service</h2>
      <p>
        WickMentor is a journal and education tool. It reads your exchange history through read-only
        keys, computes statistics and offers AI-written coaching. It never places trades or moves
        funds.
      </p>
      <h2>Not financial advice</h2>
      <p>
        Nothing in the service is investment, financial or trading advice or a recommendation to buy
        or sell anything. Figures depend on data from your exchanges and may be incomplete. AI text
        can be wrong. You are responsible for your own trading decisions. See the risk disclosure.
      </p>
      <h2>Your account</h2>
      <p>
        Keep your sign-in secure and only connect read-only keys. Do not misuse the service, try to
        access other users' data, or overload it.
      </p>
      <h2>Plans and billing</h2>
      <p>
        Paid plans are sold by Paddle.com as merchant of record and renew until cancelled. You can
        cancel any time from Plan and billing; access continues until the end of the paid period.
        Refunds follow Paddle's policy and applicable law.
      </p>
      <h2>Liability</h2>
      <p>
        The service is provided "as is". To the extent the law allows, we are not liable for trading
        losses or indirect damages, and our total liability is limited to the fees you paid in the
        previous 12 months.
      </p>
      <h2>Changes and contact</h2>
      <p>
        We will announce material changes in the app. Questions: [support email]. Governing law:
        [jurisdiction].
      </p>
    </>
  );
}
