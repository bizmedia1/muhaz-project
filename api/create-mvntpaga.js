export default async function handler(req, res) {

  /* =====================================================
     CORS
  ===================================================== */

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  /* =====================================================
     ONLY POST
  ===================================================== */

  if (req.method !== "POST") {

    return res.status(405).json({
      status: false,
      message: "Method not allowed."
    });

  }

  try {

    /* ===================================================
       MOVANTRA SECRET
    =================================================== */

    const secretKey =
      process.env.MOVANTRA_SECRET_KEY;

    if (!secretKey) {

      console.error(
        "MOVANTRA_SECRET_KEY is not configured."
      );

      return res.status(500).json({
        status: false,
        message: "Payment service is not configured."
      });

    }

    /* ===================================================
       REQUEST BODY
    =================================================== */

    const body =
      req.body || {};

    /*
      We support:

      amount       -> NGN amount
      amount_kobo  -> exact kobo amount

      Example:

      {
        "amount": 17500,
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "08012345678",
        "customer_ref": "onetime_john_123"
      }
    */

    const {
      amount,
      amount_kobo,
      name,
      customer_name,
      email,
      customer_email,
      phone,
      customer_phone,
      customer_ref,
      reference,
      expiry_minutes,
      callback_url
    } = body;

    /* ===================================================
       AMOUNT
    =================================================== */

    let finalAmountKobo;

    if (
      amount_kobo !== undefined &&
      amount_kobo !== null
    ) {

      finalAmountKobo =
        Number(amount_kobo);

    } else if (
      amount !== undefined &&
      amount !== null
    ) {

      const nairaAmount =
        Number(amount);

      if (
        !Number.isFinite(nairaAmount) ||
        nairaAmount <= 0
      ) {

        return res.status(400).json({
          status: false,
          message: "Invalid amount."
        });

      }

      /*
        Convert NGN -> kobo.

        Example:

        17,500 NGN
        ->
        1,750,000 kobo
      */

      finalAmountKobo =
        Math.round(
          nairaAmount * 100
        );

    } else {

      return res.status(400).json({
        status: false,
        message:
          "amount or amount_kobo is required."
      });

    }

    /* ===================================================
       AMOUNT VALIDATION
    =================================================== */

    if (
      !Number.isInteger(
        finalAmountKobo
      )
    ) {

      return res.status(400).json({
        status: false,
        message:
          "Amount must be a valid integer."
      });

    }

    /*
      Movantra minimum:
      10,000 kobo = ₦100
    */

    if (
      finalAmountKobo < 10000
    ) {

      return res.status(400).json({
        status: false,
        code: "amount_too_low",
        message:
          "Minimum amount is NGN 100."
      });

    }

    /* ===================================================
       CUSTOMER NAME
    =================================================== */

    const finalCustomerName =
      String(
        customer_name ||
        name ||
        ""
      ).trim();

    if (!finalCustomerName) {

      return res.status(400).json({
        status: false,
        message:
          "customer_name is required."
      });

    }

    /* ===================================================
       CUSTOMER EMAIL
    =================================================== */

    const finalCustomerEmail =
      String(
        customer_email ||
        email ||
        ""
      ).trim();

    /* ===================================================
       CUSTOMER PHONE
    =================================================== */

    const finalCustomerPhone =
      String(
        customer_phone ||
        phone ||
        ""
      ).trim();

    /* ===================================================
       REFERENCE
    =================================================== */

    let finalReference =
      String(
        reference ||
        customer_ref ||
        ""
      )
      .trim()
      .toLowerCase();

    /*
      Movantra allows:

      3-32 characters

      a-z
      0-9
      -
      _
    */

    if (finalReference) {

      finalReference =
        finalReference.replace(
          /[^a-z0-9_-]/g,
          ""
        );

    }

    /*
      If the supplied reference becomes invalid,
      create our own unique reference.
    */

    if (
      finalReference.length < 3 ||
      finalReference.length > 32
    ) {

      finalReference =
        `onetime_paga_${Date.now()}`
        .slice(0, 32);

    }

    /* ===================================================
       EXPIRY
    ===================================================== */

    let finalExpiry = 30;

    if (
      expiry_minutes !== undefined &&
      expiry_minutes !== null &&
      expiry_minutes !== ""
    ) {

      finalExpiry =
        Number(expiry_minutes);

    }

    if (
      !Number.isInteger(finalExpiry) ||
      finalExpiry < 5 ||
      finalExpiry > 60
    ) {

      return res.status(400).json({
        status: false,
        message:
          "expiry_minutes must be between 5 and 60."
      });

    }

    /* ===================================================
       MOVANTRA REQUEST
    ===================================================== */

    const movantraBody = {

      amount_kobo:
        finalAmountKobo,

      customer_name:
        finalCustomerName,

      reference:
        finalReference,

      expiry_minutes:
        finalExpiry

    };

    /*
      Optional fields
    */

    if (finalCustomerEmail) {

      movantraBody.customer_email =
        finalCustomerEmail;

    }

    if (finalCustomerPhone) {

      movantraBody.customer_phone =
        finalCustomerPhone;

    }

    /*
      callback_url is optional.

      I recommend keeping this server-side
      using an environment variable rather than
      allowing the browser to choose arbitrary
      webhook URLs.
    */

    const finalCallbackUrl =
      process.env.PAGA_CALLBACK_URL ||
      callback_url ||
      "";

    if (finalCallbackUrl) {

      movantraBody.callback_url =
        finalCallbackUrl;

    }

    /* ===================================================
       CALL MOVANTRA
    ===================================================== */

    const response =
      await fetch(
        "https://api.movantrapay.com/v1/paga/dynamic-accounts",
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${secretKey}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify(
              movantraBody
            )
        }
      );

    /* ===================================================
       READ RESPONSE
    ===================================================== */

    let result;

    try {

      result =
        await response.json();

    } catch (jsonError) {

      console.error(
        "Invalid Movantra response:",
        jsonError
      );

      return res.status(502).json({
        status: false,
        message:
          "Invalid response from payment provider."
      });

    }

    /* ===================================================
       MOVANTRA ERROR
    ===================================================== */

    if (
      !response.ok ||
      !result ||
      result.status !== true
    ) {

      console.error(
        "Movantra Paga error:",
        result
      );

      return res.status(
        response.status >= 400 &&
        response.status < 600
          ? response.status
          : 502
      ).json({

        status: false,

        code:
          result?.code ||
          "paga_account_error",

        message:
          result?.message ||
          "Unable to create Paga dynamic account."

      });

    }

    /* ===================================================
       VALIDATE ACCOUNT RESPONSE
    ===================================================== */

    if (
      !result.account_number ||
      !result.account_name ||
      !result.bank_name
    ) {

      console.error(
        "Incomplete Paga account response:",
        result
      );

      return res.status(502).json({
        status: false,
        message:
          "Paga returned an incomplete account."
      });

    }

    /* ===================================================
       RETURN CLEAN RESPONSE TO CARRD
    ===================================================== */

    return res.status(200).json({

      status: true,

      reference:
        result.reference ||
        finalReference,

      account_number:
        result.account_number,

      account_name:
        result.account_name,

      bank_name:
        result.bank_name,

      amount_kobo:
        result.amount_kobo ||
        finalAmountKobo,

      fee_kobo:
        result.fee_kobo ?? null,

      net_kobo:
        result.net_kobo ?? null,

      status_text:
        result.status_text ||
        "pending",

      expires_at:
        result.expires_at ||
        null,

      mode:
        result.mode ||
        null

    });

  } catch (error) {

    console.error(
      "Paga backend error:",
      error
    );

    return res.status(500).json({

      status: false,

      message:
        "Unable to create Paga payment account."

    });

  }

                }
