import { Resend } from 'resend';

const resend = new Resend(
  process.env.RESEND_API_KEY
);

export default async function handler(req, res) {

  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed'
    });
  }

  try {

    const {
      to,
      subject,
      html
    } = req.body;

    const data = await resend.emails.send({
      from: 'Tiny Invites <hello@tinyinvites.org>',
      to,
      subject,
      html
    });

    return res.status(200).json({
      success: true,
      data
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }
}
