const { isDatabaseConfigured, query } = require('../../lib/db');
const { isSupabaseConfigured, getSupabaseAdmin, mockDb } = require('../../lib/supabase');

function generateTicketNumber() {
    return 'TKT-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
}

module.exports = async function handler(req, res) {
    if (req.method === 'POST') {
        try {
            const { name, email, phone, order_number, category, subject, message, attachments } = req.body || {};

            if (!email || !message) {
                return res.status(400).json({ error: 'Email and message are required' });
            }

            const ticketNumber = generateTicketNumber();
            const normalizedEmail = String(email).trim().toLowerCase();

            if (isDatabaseConfigured()) {
                const insertRes = await query(`
                    INSERT INTO public.support_tickets (
                        ticket_number, customer_email, customer_phone, order_number, category, subject,
                        message, attachments, status, internal_notes, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6,
                        $7, $8, 'open', '', NOW(), NOW()
                    ) RETURNING ticket_number
                `, [
                    ticketNumber, normalizedEmail, phone ? String(phone).trim() : null,
                    order_number ? String(order_number).trim() : null,
                    category || 'General Question', subject || 'Customer Inquiry',
                    message.trim(), JSON.stringify(Array.isArray(attachments) ? attachments : [])
                ]);

                return res.status(201).json({
                    success: true,
                    ticket_number: insertRes.rows[0].ticket_number,
                    message: 'Your support case has been recorded. Our botanical care team will follow up shortly.'
                });
            }

            const newTicket = {
                id: 'tkt-' + Date.now().toString(36),
                ticket_number: ticketNumber,
                customer_email: normalizedEmail,
                customer_phone: phone ? String(phone).trim() : null,
                order_number: order_number ? String(order_number).trim() : null,
                category: category || 'General Question',
                subject: subject || 'Customer Inquiry',
                message: message.trim(),
                attachments: Array.isArray(attachments) ? attachments : [],
                status: 'open',
                internal_notes: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };

            mockDb.supportTickets.unshift(newTicket);
            return res.status(201).json({
                success: true,
                ticket_number: newTicket.ticket_number,
                message: 'Your support case has been recorded. Our botanical care team will follow up shortly.'
            });
        } catch (err) {
            console.error('[Submit Support Ticket Error]:', err);
            return res.status(500).json({ error: 'Failed to submit support case' });
        }
    }

    if (req.method === 'GET') {
        try {
            const { ticket_number, email } = req.query || {};
            if (!ticket_number || !email) {
                return res.status(400).json({ error: 'ticket_number and email are required for verification' });
            }

            const normalizedEmail = String(email).trim().toLowerCase();

            if (isDatabaseConfigured()) {
                const result = await query(`
                    SELECT ticket_number, category, subject, message, status, created_at, updated_at
                    FROM public.support_tickets
                    WHERE ticket_number = $1 AND LOWER(customer_email) = $2
                `, [ticket_number, normalizedEmail]);

                if (result.rows.length === 0) {
                    const match = (mockDb.supportTickets || []).find(
                        t => t.ticket_number === ticket_number && t.customer_email.toLowerCase() === normalizedEmail
                    );
                    if (match) {
                        return res.status(200).json({
                            ticket: {
                                ticket_number: match.ticket_number,
                                category: match.category,
                                subject: match.subject,
                                message: match.message,
                                status: match.status,
                                created_at: match.created_at,
                                updated_at: match.updated_at
                            }
                        });
                    }
                    return res.status(404).json({ error: 'Ticket not found' });
                }

                return res.status(200).json({ ticket: result.rows[0] });
            }

            const match = (mockDb.supportTickets || []).find(
                t => t.ticket_number === ticket_number && t.customer_email.toLowerCase() === normalizedEmail
            );
            if (!match) return res.status(404).json({ error: 'Ticket not found' });

            return res.status(200).json({
                ticket: {
                    ticket_number: match.ticket_number,
                    category: match.category,
                    subject: match.subject,
                    message: match.message,
                    status: match.status,
                    created_at: match.created_at,
                    updated_at: match.updated_at
                }
            });
        } catch (err) {
            return res.status(500).json({ error: 'Lookup failed' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method not allowed' });
};
