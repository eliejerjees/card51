package card51;

import java.util.*;

public class Deck {
    private final Stack<Card> drawPile = new Stack<>();
    private final Stack<Card> discardPile = new Stack<>();

    public Deck() {
        initialize();
    }

    private void initialize() {
        for (int d = 0; d < 2; d++) {
            for (Card.Suit s : Card.Suit.values()) {
                if (s == Card.Suit.JOKER)
                    continue;
                for (Card.Rank r : Card.Rank.values()) {
                    if (r == Card.Rank.JOKER)
                        continue;
                    drawPile.push(new Card(s, r));
                }
            }
        }
        drawPile.push(new Card(Card.Suit.JOKER, Card.Rank.JOKER));
        drawPile.push(new Card(Card.Suit.JOKER, Card.Rank.JOKER));
        Collections.shuffle(drawPile);
    }

    public Card draw() {
        if (drawPile.isEmpty())
            reshuffle();
        return drawPile.pop();
    }

    private void reshuffle() {
        Card top = discardPile.pop();
        drawPile.addAll(discardPile);
        discardPile.clear();
        discardPile.push(top);
        Collections.shuffle(drawPile);
    }

    public void discard(Card c) {
        discardPile.push(c);
    }

    public Card pullDiscard() {
        return discardPile.pop();
    }

    public Card peekDiscard() {
        return discardPile.peek();
    }

    public boolean isDiscardEmpty() {
        return discardPile.isEmpty();
    }
}