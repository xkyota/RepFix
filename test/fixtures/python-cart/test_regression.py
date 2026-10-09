import unittest
from cart import add_item


class IndependentCarts(unittest.TestCase):
    def test_new_customer_does_not_inherit_previous_cart(self):
        add_item("book")
        self.assertEqual(add_item("pen"), ["pen"])
