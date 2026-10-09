import unittest
from cart import add_item


class ExistingCart(unittest.TestCase):
    def test_explicit_cart_is_updated_in_place(self):
        cart = ["book"]
        self.assertIs(add_item("pen", cart), cart)
        self.assertEqual(cart, ["book", "pen"])

    def test_explicit_empty_cart_stays_same_object(self):
        cart = []
        self.assertIs(add_item("pen", cart), cart)
